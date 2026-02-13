import React, { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { ScheduleStatus } from '../types';
import * as XLSX from 'xlsx';
import { Download, Trash2, CheckCircle, CreditCard, FileText } from 'lucide-react';
import { format } from 'date-fns';
import { parseLocal, base64ToArrayBuffer } from '../utils';

// Libs loaded via CDN in index.html
declare var PizZip: any;
declare var window: any;
declare var saveAs: any;

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

  const exportWordTemplate = (item: any) => {
      // 1. Check if templates exist
      const wordTemplates = templates.filter(t => t.type === 'payment_word');
      if (wordTemplates.length === 0) {
          alert('Chưa có mẫu Word nào. Vui lòng vào mục "Hệ thống" để tải lên mẫu .docx!');
          return;
      }

      // 2. Select Template (Use first one by default for simplicity, or add a modal selector in future)
      const template = wordTemplates[0];

      try {
          // 3. Prepare Data
          const relevantSchedules = getFilteredSchedules(item);
          
          // Dates
          const startDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[0].date), 'dd/MM/yyyy') : '...';
          const endDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[relevantSchedules.length - 1].date), 'dd/MM/yyyy') : '...';
          
          const docData = {
              teacherName: item.teacherName,
              subjectName: item.subjectName,
              className: item.className,
              totalPeriods: item.totalPeriods,
              fromDate: startDate,
              toDate: endDate,
              schedules: relevantSchedules.map(s => ({
                  date: format(parseLocal(s.date), 'dd/MM/yyyy'),
                  periods: s.periodCount,
                  type: s.type === 'exam' ? 'Thi' : 'Học',
                  note: s.note || ''
              }))
          };

          // 4. Load PizZip & Docxtemplater
          const PizZip = window.PizZip;
          const Docxtemplater = window.docxtemplater;
          const saveAs = window.saveAs;

          if (!PizZip || !Docxtemplater) {
              alert("Lỗi thư viện. Hãy tải lại trang.");
              return;
          }

          const zip = new PizZip(base64ToArrayBuffer(template.content));
          const doc = new Docxtemplater(zip, {
              paragraphLoop: true,
              linebreaks: true,
          });

          // 5. Render
          doc.render(docData);

          // 6. Output
          const out = doc.getZip().generate({
              type: "blob",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });

          saveAs(out, `PhieuThanhToan_${item.subjectName}.docx`);

      } catch (error) {
          console.error(error);
          alert("Lỗi khi xuất file Word: " + error);
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
                                            onClick={() => exportWordTemplate(item)}
                                            className="bg-blue-100 hover:bg-blue-200 text-blue-800 px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors flex items-center"
                                            title="Xuất phiếu thanh toán theo mẫu (Word)"
                                        >
                                            <FileText size={14} className="mr-1" /> Word
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
