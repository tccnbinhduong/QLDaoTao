import React, { useState, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { ScheduleStatus } from '../types';
import { Filter, CheckCircle, Clock, BookOpen, User, Calendar } from 'lucide-react';
import { parseLocal } from '../utils';
import { isSameDay, startOfDay } from 'date-fns';

const TeachingProgress: React.FC = () => {
  const { classes, subjects, schedules } = useApp();
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');

  // NEW: State for manual completion (Persisted in localStorage)
  const [manualCompleted, setManualCompleted] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('manual_completed_subjects');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const toggleManualComplete = (e: React.MouseEvent, subjectId: string) => {
    e.stopPropagation(); // Prevent bubbling
    e.preventDefault(); // Prevent default behavior
    
    if (!selectedClassId) return;
    
    const key = `${subjectId}-${selectedClassId}`;
    let newList;
    
    if (manualCompleted.includes(key)) {
        // Toggle OFF
        newList = manualCompleted.filter(k => k !== key);
    } else {
        // Toggle ON (Removed confirm dialog for better UX)
        newList = [...manualCompleted, key];
    }
    
    setManualCompleted(newList);
    localStorage.setItem('manual_completed_subjects', JSON.stringify(newList));
  };

  const currentClass = classes.find(c => c.id === selectedClassId);
  
  // Define today for comparison
  const today = startOfDay(new Date());

  // Calculate progress for all subjects in the selected class
  const progressData = useMemo(() => {
    if (!currentClass) return [];

    // 1. Get subjects for this class's major
    const classSubjects = subjects.filter(s => s.majorId === currentClass.majorId);

    // 2. Calculate stats per subject
    return classSubjects.map(sub => {
      const relevantSchedules = schedules.filter(sch => 
        sch.subjectId === sub.id && 
        sch.classId === selectedClassId && 
        sch.status !== ScheduleStatus.OFF
      );

      // Calculate realized periods: Only count periods that have passed or are happening today
      const realizedPeriods = relevantSchedules.reduce((acc, curr) => {
          const sDate = parseLocal(curr.date);
          if (sDate <= today) return acc + curr.periodCount;
          return acc;
      }, 0);

      const totalPeriods = sub.totalPeriods;
      const percentage = Math.min(100, Math.round((realizedPeriods / totalPeriods) * 100));

      // Determine Status based on Dates
      const hasScheduleToday = relevantSchedules.some(s => isSameDay(parseLocal(s.date), today));
      const hasSchedulePast = relevantSchedules.some(s => parseLocal(s.date) < today);
      
      // NEW: Check manual completion
      const uniqueKey = `${sub.id}-${selectedClassId}`;
      const isManuallyCompleted = manualCompleted.includes(uniqueKey);
      const isAutoCompleted = realizedPeriods >= totalPeriods;

      let status: 'upcoming' | 'in-progress' | 'completed' = 'upcoming';

      // Priority 1: Completed (Auto or Manual)
      if (isAutoCompleted || isManuallyCompleted) {
        status = 'completed';
      } 
      // Priority 2: In Progress
      else if (hasScheduleToday || hasSchedulePast) {
        status = 'in-progress';
      } 
      // Priority 3: Upcoming
      else {
        status = 'upcoming';
      }

      return {
        ...sub,
        learnedPeriods: realizedPeriods,
        percentage, // Keep actual percentage even if manually completed for accuracy
        status,
        isAutoCompleted,
        isManuallyCompleted
      };
    }).sort((a, b) => {
        // Sort order: In Progress -> Upcoming -> Completed
        const order = { 'in-progress': 1, 'upcoming': 2, 'completed': 3 };
        return order[a.status] - order[b.status];
    });
  }, [subjects, schedules, classes, selectedClassId, currentClass, today, manualCompleted]);

  // Summary Counts
  const summary = {
    total: progressData.length,
    completed: progressData.filter(p => p.status === 'completed').length,
    inProgress: progressData.filter(p => p.status === 'in-progress').length,
    upcoming: progressData.filter(p => p.status === 'upcoming').length,
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-green-100 text-green-700 border-green-200';
      case 'in-progress': return 'bg-blue-100 text-blue-700 border-blue-200';
      default: return 'bg-gray-100 text-gray-600 border-gray-200';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'completed': return 'Đã học';
      case 'in-progress': return 'Đang học';
      default: return 'Sắp học';
    }
  };

  const getProgressBarColor = (status: string) => {
     switch (status) {
      case 'completed': return 'bg-green-500';
      case 'in-progress': return 'bg-blue-500';
      default: return 'bg-gray-300';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-800">Tiến độ giảng dạy</h1>
        
        <div className="flex items-center gap-3 bg-white p-2 rounded shadow-sm border">
            <Filter size={20} className="text-blue-600" />
            <span className="font-semibold text-gray-700 whitespace-nowrap text-sm">Chọn lớp xem:</span>
            <select 
                className="border-none outline-none bg-transparent font-medium text-gray-800 min-w-[200px]"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
            >
                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
           <div className="text-gray-500 text-xs font-semibold uppercase">Tổng môn học</div>
           <div className="text-2xl font-bold text-gray-800 mt-1">{summary.total}</div>
        </div>
        <div className="bg-blue-50 p-4 rounded-xl shadow-sm border border-blue-100">
           <div className="text-blue-600 text-xs font-semibold uppercase">Đang học</div>
           <div className="text-2xl font-bold text-blue-700 mt-1">{summary.inProgress}</div>
        </div>
        <div className="bg-green-50 p-4 rounded-xl shadow-sm border border-green-100">
           <div className="text-green-600 text-xs font-semibold uppercase">Đã hoàn thành</div>
           <div className="text-2xl font-bold text-green-700 mt-1">{summary.completed}</div>
        </div>
        <div className="bg-gray-50 p-4 rounded-xl shadow-sm border border-gray-200">
           <div className="text-gray-500 text-xs font-semibold uppercase">Sắp học</div>
           <div className="text-2xl font-bold text-gray-600 mt-1">{summary.upcoming}</div>
        </div>
      </div>

      {/* Progress List View */}
      <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
             <h3 className="font-bold text-gray-700">Chi tiết môn học</h3>
             <span className="text-sm text-gray-500">Tổng số: {progressData.length} môn</span>
          </div>
          
          <div className="divide-y divide-gray-100">
             {progressData.map(subject => (
                 <div key={subject.id} className="p-4 hover:bg-gray-50 transition flex flex-col md:flex-row items-center gap-4">
                     {/* Icon & Name */}
                     <div className="flex items-start gap-3 flex-1 w-full md:w-1/3">
                        <div className={`p-2 rounded-lg flex-shrink-0 ${subject.status === 'in-progress' ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'}`}>
                             <BookOpen size={20} />
                        </div>
                        <div>
                             <h4 className="font-bold text-gray-800">{subject.name}</h4>
                             <div className="flex items-center text-sm text-gray-500 mt-1">
                                <User size={14} className="mr-1" />
                                {subject.teacher1 || <span className="italic text-gray-400">Chưa phân công</span>}
                             </div>
                        </div>
                     </div>

                     {/* Progress Bar */}
                     <div className="flex-[2] w-full md:w-auto px-2">
                        <div className="flex justify-between text-xs mb-1.5 font-medium">
                            <span className="text-gray-600">Tiến độ: {subject.learnedPeriods} / {subject.totalPeriods} tiết</span>
                            <span className={`${subject.status === 'completed' ? 'text-green-600' : subject.status === 'in-progress' ? 'text-blue-600' : 'text-gray-400'}`}>
                                {subject.percentage}%
                            </span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                            <div 
                                className={`h-3 rounded-full transition-all duration-500 ${getProgressBarColor(subject.status)}`} 
                                style={{ width: `${subject.percentage}%` }}
                            ></div>
                        </div>
                     </div>

                     {/* Status Badge & Manual Toggle */}
                     <div className="w-full md:w-48 flex justify-end md:justify-center items-center gap-3">
                         <span className={`px-3 py-1 rounded-full text-xs font-bold border whitespace-nowrap flex items-center gap-1 ${getStatusColor(subject.status)}`}>
                            {subject.status === 'completed' && <CheckCircle size={12} />}
                            {subject.status === 'in-progress' && <Clock size={12} />}
                            {subject.status === 'upcoming' && <Calendar size={12} />}
                            {getStatusLabel(subject.status)}
                         </span>
                         
                         {/* Manual Toggle Button */}
                         {!subject.isAutoCompleted && (
                            <button
                                type="button"
                                onClick={(e) => toggleManualComplete(e, subject.id)}
                                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors shadow-sm whitespace-nowrap cursor-pointer z-10 relative ${
                                    subject.isManuallyCompleted 
                                    ? "bg-white text-red-500 border border-red-200 hover:bg-red-50" 
                                    : "bg-blue-600 text-white border border-blue-600 hover:bg-blue-700"
                                }`}
                                title={subject.isManuallyCompleted ? "Hủy xác nhận hoàn thành" : "Xác nhận môn học đã hoàn thành"}
                            >
                                {subject.isManuallyCompleted ? "Hủy" : "Đã học"}
                            </button>
                         )}
                     </div>
                 </div>
             ))}

             {progressData.length === 0 && (
                <div className="p-8 text-center text-gray-400 italic">
                    Chưa có môn học nào thuộc ngành của lớp này.
                </div>
             )}
          </div>
      </div>
    </div>
  );
};

export default TeachingProgress;