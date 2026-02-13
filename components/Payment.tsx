import React, { useMemo, useState } from 'react';
import { useApp } from '../store/AppContext';
import { ScheduleStatus } from '../types';
import XLSX from 'xlsx';
import { Download, Trash2, CheckCircle, CreditCard } from 'lucide-react';
import { format } from 'date-fns';
import { parseLocal } from '../utils';

const Payment: React.FC = () => {
  const { teachers, schedules, subjects, classes } = useApp();

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

  const exportFinishedSubject = (item: any) => {
    const relevantSchedules = schedules
      .filter(s => s.subjectId === item.subjectId && s.classId === item.classId && s.status !== ScheduleStatus.OFF)
      .sort((a, b) => {
          // Sort by date then startPeriod
          const da = new Date(a.date).getTime();
          const db = new Date(b.date).getTime();
          return da - db || a.startPeriod - b.startPeriod;
      });

    const data = relevantSchedules.map(s => ({
       'Giáo viên giảng dạy': teachers.find(t => t.id === s.teacherId)?.name || 'GV đã xóa',
       'Ngày dạy': format(parseLocal(s.date), 'dd/MM/yyyy'),
       'Số tiết dạy': s.periodCount,
       'Lớp': item.className
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 12 }, { wch: 20 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ChiTietMonHoc");
    XLSX.writeFile(wb, `ThongKe_${item.subjectName}_${item.className}.xlsx`);
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
                            <th className="p-4 text-gray-600 font-semibold text-sm w-32 text-center">Thao tác</th>
                            <th className="p-4 text-gray-600 font-semibold text-sm w-48 text-center">Trạng thái thanh toán</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {completedSubjects.map((item: any) => (
                            <tr key={item.uniqueKey} className="hover:bg-gray-50 transition-colors">
                                <td className="p-4 text-gray-800 font-medium text-[15px]">
                                    {item.subjectName} - GV: {item.teacherName} - Lớp: {item.className}
                                </td>
                                <td className="p-4 text-center">
                                    <button 
                                        onClick={() => exportFinishedSubject(item)}
                                        className="bg-yellow-100 hover:bg-yellow-200 text-yellow-800 px-3 py-1.5 rounded text-sm font-medium whitespace-nowrap transition-colors flex items-center justify-center mx-auto"
                                    >
                                        <Download size={14} className="mr-1" /> Xuất Excel
                                    </button>
                                </td>
                                <td className="p-4 text-center">
                                    <button
                                        onClick={() => handleDelete(item.uniqueKey)}
                                        className="bg-red-100 hover:bg-red-200 text-red-700 px-4 py-1.5 rounded text-sm font-medium transition-colors flex items-center justify-center mx-auto"
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