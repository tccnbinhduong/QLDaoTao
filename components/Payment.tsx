import React, { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { ScheduleStatus } from '../types';
import *as XLSX from 'xlsx';
import { Download, Trash2, CheckCircle, CreditCard, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { parseLocal } from '../utils';

const Payment: React.FC = () => {
  const { teachers, schedules, subjects, classes, templates } = useApp();

  // State to track paid/removed subjects (persisted in localStorage)
  // Store format: "subjectId-classId"
  const [paidItems, setPaidItems] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('paid_completed_subjects');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Calculate Completed Subjects (Finished)
  const completedSubjects = useMemo(() => {
    const results: any[] = [];
    
    classes.forEach(cls => {
        const classSubjects = subjects.filter(s => s.majorId === cls.majorId);
        
        classSubjects.forEach(sub => {
            // Unique key for payment tracking
            const uniqueKey = `${sub.id}-${cls.id}`;

            // Skip if already paid/deleted
            if (paidItems.includes(uniqueKey)) return;

             const relevantSchedules = schedules.filter(sch => 
                sch.subjectId === sub.id && 
                sch.classId === cls.id && 
                sch.status !== ScheduleStatus.OFF
            );
            
            const learned = relevantSchedules.reduce((acc, curr) => acc + curr.periodCount, 0);
            
            // Condition: Learned >= Total AND started (learned > 0)
            if (learned >= sub.totalPeriods && learned > 0) {
                 // Get list of teachers who taught this subject for this class
                 const teacherIds = Array.from(new Set(relevantSchedules.map(s => s.teacherId)));
                 const teacherNames = teacherIds.map(tid => teachers.find(t => t.id === tid)?.name || 'GV đã xóa').join(', ');

                 results.push({
                     subjectId: sub.id,
                     classId: cls.id,
                     uniqueKey: uniqueKey,
                     subjectName: sub.name,
                     className: cls.name,
                     teacherName: teacherNames || "Chưa xác định",
                     totalPeriods: sub.totalPeriods
                 });
            }
        });
    });
    
    return results;
  }, [subjects, schedules, classes, teachers, paidItems]);

  const handleDelete = (key: string) => {
    setPaidItems(prev => {
        const newPaidItems = [...prev, key];
        localStorage.setItem('paid_completed_subjects', JSON.stringify(newPaidItems));
        return newPaidItems;
    });
  };

  const getFilteredSchedules = (item: any) => {
      return schedules
      .filter(s => {
          if (s.subjectId !== item.subjectId || s.classId !== item.classId || s.status === ScheduleStatus.OFF) return false;
          
          if (s.type === 'class') return true;
          if (s.type === 'exam') {
              return s.note && s.note.toLowerCase().includes('thực hành');
          }
          return false;
      })
      .sort((a, b) => {
          // Sort by date then startPeriod
          const da = new Date(a.date).getTime();
          const db = new Date(b.date).getTime();
          return da - db || a.startPeriod - b.startPeriod;
      });
  }

  const exportFinishedSubject = (item: any) => {
    const relevantSchedules = getFilteredSchedules(item);

    const data = relevantSchedules.map(s => ({
       'Giáo viên giảng dạy': teachers.find(t => t.id === s.teacherId)?.name || 'GV đã xóa',
       'Ngày dạy': format(parseLocal(s.date), 'dd/MM/yyyy'),
       'Số tiết dạy': s.periodCount,
       'Lớp': item.className,
       'Loại': s.type === 'exam' ? 'Thi' : 'Học',
       'Ghi chú': s.note || ''
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 12 }, { wch: 20 }, { wch: 10 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ChiTietMonHoc");
    XLSX.writeFile(wb, `ThongKe_${item.subjectName}_${item.className}.xlsx`);
  };

  const exportExcelTemplate = (item: any) => {
      // 1. Check if templates exist
      const excelTemplates = templates.filter(t => t.type === 'payment_excel');
      if (excelTemplates.length === 0) {
          alert('Chưa có mẫu Excel nào. Vui lòng vào mục "Hệ thống" để tải lên mẫu .xlsx!');
          return;
      }

      // 2. Select Template (Use first one by default)
      const template = excelTemplates[0];

      try {
          // 3. Prepare Data
          const relevantSchedules = getFilteredSchedules(item);
          const firstSchedule = relevantSchedules[0];
          const teacherObj = firstSchedule ? teachers.find(t => t.id === firstSchedule.teacherId) : null;
          const startDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[0].date), 'dd/MM/yyyy') : '...';
          const endDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[relevantSchedules.length - 1].date), 'dd/MM/yyyy') : '...';
          const actualTotalPeriods = relevantSchedules.reduce((sum, s) => sum + s.periodCount, 0);

          const replacements: Record<string, string> = {
              "{teacherName}": item.teacherName,
              "{teacherPhone}": teacherObj?.phone || '',
              "{teacherBank}": teacherObj?.bank || '',
              "{teacherAccount}": teacherObj?.accountNumber || '',
              "{subjectName}": item.subjectName,
              "{className}": item.className,
              "{totalPeriods}": String(item.totalPeriods),
              "{actualTotalPeriods}": String(actualTotalPeriods),
              "{fromDate}": startDate,
              "{toDate}": endDate,
          };

          // 4. Read Template (STRIP BASE64 PREFIX)
          const base64Content = template.content.split(',')[1];
          const wb = XLSX.read(base64Content, { type: 'base64' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          
          if (!ws['!ref']) {
              alert("File mẫu Excel không có dữ liệu!");
              return;
          }

          const range = XLSX.utils.decode_range(ws['!ref']);

          // 5. Replace Scalars
          for (let R = range.s.r; R <= range.e.r; ++R) {
              for (let C = range.s.c; C <= range.e.c; ++C) {
                   const cellRef = XLSX.utils.encode_cell({r: R, c: C});
                   if(!ws[cellRef] || ws[cellRef].t !== 's') continue;
                   let val = ws[cellRef].v;
                   Object.keys(replacements).forEach(key => {
                       if(val.includes(key)) val = val.replace(key, replacements[key]);
                   });
                   ws[cellRef].v = val;
              }
          }

          // 6. Find List Header and Insert Data
          // Look for row with {date} placeholder
          let startRow = -1;
          const colMap: any = {};
          
          for (let R = range.s.r; R <= range.e.r; ++R) {
              for (let C = range.s.c; C <= range.e.c; ++C) {
                  const cellRef = XLSX.utils.encode_cell({r: R, c: C});
                  if(!ws[cellRef]) continue;
                  const val = String(ws[cellRef].v);
                  if(val.includes('{date}')) { startRow = R; colMap['date'] = C; ws[cellRef].v = "Ngày dạy"; }
                  if(val.includes('{periods}')) { startRow = R; colMap['periods'] = C; ws[cellRef].v = "Số tiết"; }
                  if(val.includes('{type}')) { startRow = R; colMap['type'] = C; ws[cellRef].v = "Nội dung"; }
                  if(val.includes('{note}')) { startRow = R; colMap['note'] = C; ws[cellRef].v = "Ghi chú"; }
              }
              if(startRow !== -1) break;
          }

          if (startRow !== -1) {
              // Write data rows immediately after header, overwriting existing rows below
              relevantSchedules.forEach((s, idx) => {
                   const row = startRow + 1 + idx;
                   if (colMap['date'] !== undefined) XLSX.utils.sheet_add_aoa(ws, [[ format(parseLocal(s.date), 'dd/MM/yyyy') ]], {origin: {r: row, c: colMap['date']}});
                   if (colMap['periods'] !== undefined) XLSX.utils.sheet_add_aoa(ws, [[ s.periodCount ]], {origin: {r: row, c: colMap['periods']}});
                   if (colMap['type'] !== undefined) XLSX.utils.sheet_add_aoa(ws, [[ s.type === 'exam' ? 'Thi' : 'Học' ]], {origin: {r: row, c: colMap['type']}});
                   if (colMap['note'] !== undefined) XLSX.utils.sheet_add_aoa(ws, [[ s.note || '' ]], {origin: {r: row, c: colMap['note']}});
              });

              // Extend range if needed
              const newMaxRow = startRow + 1 + relevantSchedules.length;
              if(newMaxRow > range.e.r) {
                  ws['!ref'] = XLSX.utils.encode_range({s: range.s, e: {r: newMaxRow, c: range.e.c}});
              }
          }

          XLSX.writeFile(wb, `PhieuThanhToan_${item.subjectName}.xlsx`);

      } catch (error) {
          console.error(error);
          alert("Lỗi khi xuất file Excel: " + error);
      }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center">
        <CreditCard className="mr-3 text-blue-600" /> Thanh toán giảng dạy
      </h1>
      
      <div className="bg-white p-6 rounded-xl shadow border border-gray-200">
        <h3 className="font-bold text-gray-800 text-lg mb-4 flex items-center">
            <CheckCircle className="mr-2 text-green-500" size={20} />
            Môn học đã kết thúc (Chờ thanh toán)
        </h3>
        
        {completedSubjects.length > 0 ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="w-full text-left bg-white">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="p-4 text-gray-600 font-semibold text-sm">Thông tin môn học</th>
                            <th className="p-4 text-gray-600 font-semibold text-sm w-48 text-center">Thao tác</th>
                            <th className="p-4 text-gray-600 font-semibold text-sm w-32 text-center">Trạng thái</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {completedSubjects.map((item: any) => (
                            <tr key={item.uniqueKey} className="hover:bg-gray-50 transition-colors">
                                <td className="p-4 text-gray-800 font-medium text-[15px]">
                                    {item.subjectName} - GV: {item.teacherName} - Lớp: {item.className}
                                </td>
                                <td className="p-4 text-center">
                                    <div className="flex justify-center gap-2">
                                        <button 
                                            onClick={() => exportFinishedSubject(item)}
                                            className="bg-green-100 hover:bg-green-200 text-green-800 px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors flex items-center"
                                            title="Xuất bảng kê chi tiết (Excel)"
                                        >
                                            <Download size={14} className="mr-1" /> Excel
                                        </button>
                                        <button 
                                            onClick={() => exportExcelTemplate(item)}
                                            className="bg-orange-100 hover:bg-orange-200 text-orange-800 px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors flex items-center"
                                            title="Xuất phiếu thanh toán theo mẫu (Excel)"
                                        >
                                            <FileSpreadsheet size={14} className="mr-1" /> Excel (Mẫu)
                                        </button>
                                    </div>
                                </td>
                                <td className="p-4 text-center">
                                    <button
                                        onClick={() => handleDelete(item.uniqueKey)}
                                        className="bg-red-50 hover:bg-red-100 text-red-600 px-3 py-1.5 rounded text-sm font-medium transition-colors flex items-center justify-center mx-auto"
                                    >
                                        <Trash2 size={14} className="mr-1" /> Xóa
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        ) : (
            <div className="text-gray-500 italic py-12 text-center bg-gray-50 rounded border border-dashed border-gray-200">
                Chưa có môn học nào hoàn thành (hoặc tất cả đã được thanh toán).
            </div>
        )}
      </div>
    </div>
  );
};

export default Payment;
