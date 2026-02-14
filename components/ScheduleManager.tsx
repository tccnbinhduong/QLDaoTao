import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import { checkConflict, calculateSubjectProgress, getSessionFromPeriod, parseLocal, determineStatus, getSessionSequenceInfo, generateId, base64ToArrayBuffer } from '../utils';
import { ScheduleItem, ScheduleStatus, Teacher } from '../types';
import { format, addDays, isSameDay, getWeek } from 'date-fns';
import { vi } from 'date-fns/locale/vi';
import { Calendar as CalendarIcon, Plus, ChevronRight, ChevronLeft, AlertCircle, Save, Trash2, FileSpreadsheet, ListFilter, X, Copy, Clipboard, Users, Download, BookOpen, Mail } from 'lucide-react';
import *as XLSX from 'xlsx';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import saveAs from 'file-saver';

const DAYS_OF_WEEK = [
  { label: 'Thứ 2', val: 1 },
  { label: 'Thứ 3', val: 2 },
  { label: 'Thứ 4', val: 3 },
  { label: 'Thứ 5', val: 4 },
  { label: 'Thứ 6', val: 5 },
  { label: 'Thứ 7', val: 6 },
];

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const ScheduleManager: React.FC = () => {
  const { schedules, classes, teachers, subjects, templates, addSchedule, updateSchedule, deleteSchedule } = useApp();
  
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  const [viewDate, setViewDate] = useState(new Date());
  const [showAddModal, setShowAddModal] = useState(false);
  const [editItem, setEditItem] = useState<ScheduleItem | null>(null);
  
  // State for Drag and Drop
  const [draggedItem, setDraggedItem] = useState<ScheduleItem | null>(null);

  // State for Copy/Paste (Context Menu)
  const [copiedItem, setCopiedItem] = useState<ScheduleItem | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    show: boolean;
    x: number;
    y: number;
    target?: { date: Date; period: number; item?: ScheduleItem };
  }>({ show: false, x: 0, y: 0 });

  // Form State
  const [formTeacherId, setFormTeacherId] = useState('');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formType, setFormType] = useState<'class' | 'exam'>('class');
  const [formRoom, setFormRoom] = useState('');
  const [formDate, setFormDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [formStartPeriod, setFormStartPeriod] = useState(1);
  const [formPeriodCount, setFormPeriodCount] = useState(3);
  const [formError, setFormError] = useState('');
  const [formNote, setFormNote] = useState(''); // New Note Field

  // NEW: State for Shared Class Selection
  const [selectedSharedClasses, setSelectedSharedClasses] = useState<string[]>([]);

  const getStartOfWeek = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); 
    return new Date(d.setDate(diff));
  };

  // Derived state
  const weekStart = getStartOfWeek(viewDate);
  const weekDays = DAYS_OF_WEEK.map((d, i) => addDays(weekStart, i));
  const weekNumber = getWeek(viewDate);

  const filteredSchedules = useMemo(() => {
    return schedules.filter(s => s.classId === selectedClassId);
  }, [schedules, selectedClassId]);

  // Filter subjects based on the selected class's major AND completion status
  const availableSubjects = useMemo(() => {
    const currentClass = classes.find(c => c.id === selectedClassId);
    if (!currentClass) return subjects; 
    
    // 1. Get completion data from LocalStorage (Manual & Paid)
    let manualCompleted: string[] = [];
    let paidCompleted: string[] = [];
    try {
        const manual = localStorage.getItem('manual_completed_subjects');
        if (manual) manualCompleted = JSON.parse(manual);

        const paid = localStorage.getItem('paid_completed_subjects');
        if (paid) paidCompleted = JSON.parse(paid);
    } catch (e) {
        console.error(e);
    }

    const currentType = editItem ? editItem.type : formType;

    return subjects.filter(s => {
        // Must match Major
        if (s.majorId !== currentClass.majorId) return false;

        // If we are Editing an item, ALWAYS show its current subject (even if completed)
        // so the dropdown selects it correctly.
        if (editItem && editItem.subjectId === s.id) return true;

        const uniqueKey = `${s.id}-${currentClass.id}`;
        
        // Determine Finished Status
        const isManuallyFinished = manualCompleted.includes(uniqueKey) || paidCompleted.includes(uniqueKey);

        const relevantSchedules = schedules.filter(sch => 
            sch.subjectId === s.id && 
            sch.classId === currentClass.id && 
            sch.status !== ScheduleStatus.OFF
        );
        
        const learned = relevantSchedules
            .filter(sch => sch.type === 'class')
            .reduce((acc, curr) => acc + curr.periodCount, 0);

        const isAutoFinished = learned >= s.totalPeriods;
        const isFinished = isManuallyFinished || isAutoFinished;

        if (currentType === 'exam') {
             // Exam Logic:
             // Hide if NOT Finished (Currently Learning/Upcoming)
             if (!isFinished) return false;
             
             // Hide if Already has Exam
             const hasExam = relevantSchedules.some(sch => sch.type === 'exam');
             if (hasExam) return false;
             
             return true;
        } else {
             // Class Logic:
             // Hide if Finished
             if (isFinished) return false;
             
             return true;
        }
    });
  }, [subjects, classes, selectedClassId, schedules, editItem, formType]);

  // NEW: Calculate Active Subjects for the current class (displayed in the new section)
  const activeSubjectsSummary = useMemo(() => {
    const classSchedules = schedules.filter(s => s.classId === selectedClassId && s.status !== ScheduleStatus.OFF);
    const uniqueSubjectIds = Array.from(new Set(classSchedules.map(s => s.subjectId)));

    return uniqueSubjectIds.map(subId => {
        const sub = subjects.find(s => s.id === subId);
        // Find main teacher (the one who taught the most recently added schedule for this subject)
        const subjectSchedules = classSchedules.filter(s => s.subjectId === subId).sort((a,b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const latestSchedule = subjectSchedules[0];
        const teacher = teachers.find(t => t.id === latestSchedule?.teacherId);
        const cls = classes.find(c => c.id === selectedClassId);

        return {
            id: subId,
            classId: selectedClassId, // Needed for query
            teacherId: teacher?.id, // Needed for query
            subjectName: sub?.name || 'Unknown',
            teacherName: teacher?.name || 'Chưa cập nhật',
            totalPeriods: sub?.totalPeriods || 0,
            className: cls?.name || ''
        };
    });
  }, [schedules, subjects, teachers, classes, selectedClassId]);

  // NEW: Group teachers by recommendation based on selected subject
  const currentSubjectId = editItem ? editItem.subjectId : formSubjectId;
  const { suggestedTeachers, otherTeachers } = useMemo(() => {
    const subj = subjects.find(s => s.id === currentSubjectId);
    if (!subj) return { suggestedTeachers: [], otherTeachers: teachers };

    const responsibleNames = [subj.teacher1, subj.teacher2, subj.teacher3]
        .filter(n => n && n.trim() !== '')
        .map(n => n!.toLowerCase().trim());
    
    if (responsibleNames.length === 0) return { suggestedTeachers: [], otherTeachers: teachers };

    const suggested: Teacher[] = [];
    const others: Teacher[] = [];

    teachers.forEach(t => {
        if (responsibleNames.includes(t.name.toLowerCase().trim())) {
            suggested.push(t);
        } else {
            others.push(t);
        }
    });
    
    return { suggestedTeachers: suggested, otherTeachers: others };
  }, [currentSubjectId, teachers, subjects]);


  // Check if current form subject is shared
  const currentFormSubject = subjects.find(s => s.id === currentSubjectId);
  const isFormSubjectShared = !!currentFormSubject?.isShared;

  // Initialize shared classes when form opens or subject changes
  useEffect(() => {
    if (showAddModal && !editItem) {
        // If it's a shared subject, ensure current class is selected.
        // If switching to a shared subject, reset to just current class initially
        if (!selectedSharedClasses.includes(selectedClassId)) {
            setSelectedSharedClasses([selectedClassId]);
        }
    }
  }, [showAddModal, formSubjectId, selectedClassId]);


  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu({ ...contextMenu, show: false });
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [contextMenu]);

  // Reset form subject when available subjects change (i.e. class changes) and current selection is invalid
  useEffect(() => {
    if (formSubjectId && !availableSubjects.some(s => s.id === formSubjectId)) {
      setFormSubjectId('');
    }
  }, [availableSubjects, formSubjectId]);

  const handlePrevWeek = () => setViewDate(addDays(viewDate, -7));
  const handleNextWeek = () => setViewDate(addDays(viewDate, 7));

  const resetForm = () => {
    setFormTeacherId('');
    setFormSubjectId('');
    setFormRoom('');
    setFormDate(format(new Date(), 'yyyy-MM-dd'));
    setFormStartPeriod(1);
    setFormPeriodCount(3);
    setFormError('');
    setFormNote('');
    setEditItem(null);
    setFormType('class');
    setSelectedSharedClasses([selectedClassId]);
  };

  // Helper to find all related items for a shared subject (siblings in other classes)
  const getRelatedSharedItems = (sourceItem: ScheduleItem) => {
    const subject = subjects.find(s => s.id === sourceItem.subjectId);
    if (!subject?.isShared) return [sourceItem];

    // Find items with same Subject, Teacher, Room, Date, StartPeriod
    return schedules.filter(s => 
        s.subjectId === sourceItem.subjectId &&
        s.teacherId === sourceItem.teacherId &&
        s.roomId === sourceItem.roomId &&
        s.date === sourceItem.date &&
        s.startPeriod === sourceItem.startPeriod
        // Note: Removed status check to include OFF items in sync
    );
  };

  // Helper to find the teacher who taught a subject for a class
  const getTeacherForSubject = (subjId: string, clsId: string) => {
    const matches = schedules.filter(s => 
        s.subjectId === subjId && 
        s.classId === clsId && 
        s.type === 'class' &&
        s.status !== ScheduleStatus.OFF
    );
    if (matches.length === 0) return '';
    // Return latest teacher
    const latest = matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
    return latest.teacherId;
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, item: ScheduleItem) => {
    setDraggedItem(item);
    e.dataTransfer.effectAllowed = "copy";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // Allows dropping
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent, targetDate: Date, targetPeriod: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    const targetDateStr = format(targetDate, 'yyyy-MM-dd');

    // Avoid copying to the exact same slot
    if (draggedItem.date === targetDateStr && draggedItem.startPeriod === targetPeriod) {
        setDraggedItem(null);
        return;
    }

    // Determine items to copy (Single or Batch for Shared)
    const itemsToCopy = getRelatedSharedItems(draggedItem);
    let successCount = 0;

    itemsToCopy.forEach(sourceItem => {
        const newItem = {
            type: sourceItem.type,
            teacherId: sourceItem.teacherId,
            subjectId: sourceItem.subjectId,
            classId: sourceItem.classId,
            roomId: sourceItem.roomId,
            date: targetDateStr,
            session: getSessionFromPeriod(targetPeriod),
            startPeriod: targetPeriod,
            periodCount: sourceItem.periodCount,
        };

        const conflict = checkConflict(newItem, schedules, subjects); 
        if (!conflict.hasConflict) {
            addSchedule(newItem);
            successCount++;
        }
    });

    if (successCount === 0) {
        alert(`Không thể sao chép (Trùng lịch).`);
    } else if (itemsToCopy.length > 1 && successCount < itemsToCopy.length) {
         alert(`Đã sao chép ${successCount}/${itemsToCopy.length} lớp (Một số lớp bị trùng lịch).`);
    }

    setDraggedItem(null);
  };

  // Context Menu Handlers
  const handleContextMenu = (e: React.MouseEvent, date: Date, period: number, item?: ScheduleItem) => {
    e.preventDefault();
    setContextMenu({
      show: true,
      x: e.pageX,
      y: e.pageY,
      target: { date, period, item }
    });
  };

  const handleCopy = () => {
    if (contextMenu.target?.item) {
      setCopiedItem(contextMenu.target.item);
    }
    setContextMenu({ ...contextMenu, show: false });
  };

  const handlePaste = () => {
    if (!copiedItem || !contextMenu.target) return;

    // 1. Get Source Subject Info
    const sourceSubject = subjects.find(s => s.id === copiedItem.subjectId);
    if (!sourceSubject) return;

    // 2. Determine Items to Paste
    const sourceItems = getRelatedSharedItems(copiedItem);
    const targetDateStr = format(contextMenu.target.date, 'yyyy-MM-dd');
    const targetPeriod = contextMenu.target.period;
    let pastedCount = 0;

    sourceItems.forEach(src => {
        const newItem = {
            type: src.type,
            teacherId: src.teacherId,
            subjectId: src.subjectId, // Same subject ID
            classId: src.classId,     // Keep the class ID from source to maintain the "Shared Group"
            roomId: src.roomId,
            date: targetDateStr,
            session: getSessionFromPeriod(targetPeriod),
            startPeriod: targetPeriod,
            periodCount: src.periodCount,
            status: ScheduleStatus.PENDING 
        };

        // Check conflicts
        const conflict = checkConflict(newItem, schedules, subjects);
        if (!conflict.hasConflict) {
            addSchedule(newItem);
            pastedCount++;
        }
    });

    if (pastedCount === 0) {
        alert("Không thể dán (Trùng lịch).");
    }

    setContextMenu({ ...contextMenu, show: false });
  };

  const handleDeleteItem = () => {
      if (!editItem) return;
      
      const originalItem = schedules.find(s => s.id === editItem.id);
      if (!originalItem) return;

      const relatedItems = getRelatedSharedItems(originalItem);
      
      if (relatedItems.length > 1) {
          if (!window.confirm(`Đây là môn học chung (Lớp ghép). Xóa buổi học này sẽ xóa lịch của TẤT CẢ ${relatedItems.length} lớp tham gia. Bạn có chắc chắn muốn xóa?`)) {
              return;
          }
      } else {
          if (!window.confirm("Bạn có chắc chắn muốn xóa buổi học này?")) {
              return;
          }
      }

      relatedItems.forEach(item => deleteSchedule(item.id));
      setShowAddModal(false);
  }

  const handleStatusChange = (newStatus: ScheduleStatus) => {
    if (!editItem) return;
    
    const originalItem = schedules.find(s => s.id === editItem.id);
    if (!originalItem) return;

    const relatedItems = getRelatedSharedItems(originalItem);
    
    // Auto-update all shared items
    relatedItems.forEach(item => {
        updateSchedule(item.id, { status: newStatus });
    });

    setEditItem({ ...editItem, status: newStatus });
  };

  const handleSaveSchedule = () => {
    // Determine values based on whether we are editing or creating
    const teacherId = editItem ? editItem.teacherId : formTeacherId;
    const subjectId = editItem ? editItem.subjectId : formSubjectId;
    const roomId = editItem ? editItem.roomId : formRoom;
    const classId = editItem ? editItem.classId : selectedClassId;
    const type = editItem ? editItem.type : formType;
    const date = editItem ? editItem.date : formDate;
    const startPeriod = editItem ? editItem.startPeriod : formStartPeriod;
    const periodCount = editItem ? editItem.periodCount : formPeriodCount;
    const note = editItem ? editItem.note : formNote;

    if (!teacherId || !subjectId || !roomId || !classId) {
      setFormError('Vui lòng điền đầy đủ thông tin');
      return;
    }

    const baseItem = {
      type,
      teacherId,
      subjectId,
      classId, // Default placeholder
      roomId,
      date,
      session: getSessionFromPeriod(startPeriod),
      startPeriod,
      periodCount,
      note,
    };

    if (editItem) {
        // Edit Mode
        const originalItem = schedules.find(s => s.id === editItem.id);
        if (originalItem) {
            const relatedItems = getRelatedSharedItems(originalItem);

            // 2. Validate conflicts for ALL siblings with NEW data
            for (const item of relatedItems) {
                 const itemToCheck = { ...baseItem, classId: item.classId };
                 const conflict = checkConflict(itemToCheck, schedules, subjects, item.id);
                 if (conflict.hasConflict) {
                     const className = classes.find(c => c.id === item.classId)?.name;
                     setFormError(`Lớp ${className}: ${conflict.message}`);
                     return;
                 }
            }

            // 3. Update ALL siblings
            relatedItems.forEach(item => {
                updateSchedule(item.id, { ...baseItem, classId: item.classId });
            });
        }
    } else {
        // Add Mode
        const targetClassIds = isFormSubjectShared ? selectedSharedClasses : [classId];

        // 1. Validation Phase
        for (const targetId of targetClassIds) {
            const itemToCheck = { ...baseItem, classId: targetId };
            const conflict = checkConflict(itemToCheck, schedules, subjects);
            if (conflict.hasConflict) {
                 const className = classes.find(c => c.id === targetId)?.name;
                 setFormError(`Lớp ${className}: ${conflict.message}`);
                 return; 
            }
        }

        // 2. Execution Phase
        targetClassIds.forEach(targetId => {
            const newItem = { ...baseItem, classId: targetId };
            addSchedule(newItem);
        });
    }
    
    setShowAddModal(false);
    resetForm();
  };

  const handleContinueNextWeek = () => {
    // Logic: Copy current week's schedule to next week if subjects not finished
    const currentWeekSchedules = filteredSchedules.filter(s => {
       const d = parseLocal(s.date);
       return d >= weekStart && d < addDays(weekStart, 6);
    }).sort((a, b) => {
        const da = parseLocal(a.date).getTime();
        const db = parseLocal(b.date).getTime();
        if (da !== db) return da - db;
        return a.startPeriod - b.startPeriod;
    });

    let addedCount = 0;
    let warnings: string[] = [];
    const addedPeriodsMap: Record<string, number> = {};
    const processedSharedKeys: Set<string> = new Set(); // To avoid processing same shared group multiple times

    currentWeekSchedules.forEach(item => {
      if (item.type === 'exam') return;

      const subject = subjects.find(s => s.id === item.subjectId);
      if (!subject) return;

      const slotKey = `${item.date}-${item.startPeriod}-${item.teacherId}-${item.subjectId}`;
      let itemsToProcess = [item];

      // If Shared Subject: Find all parallel classes for this slot
      if (subject.isShared) {
          if (processedSharedKeys.has(slotKey)) return; 
          
          const sharedGroup = getRelatedSharedItems(item);
          if (sharedGroup.length > 0) {
              itemsToProcess = sharedGroup;
              processedSharedKeys.add(slotKey);
          }
      }

      itemsToProcess.forEach(sourceItem => {
          const key = `${sourceItem.subjectId}-${sourceItem.classId}`;
          const previouslyAdded = addedPeriodsMap[key] || 0;
          
          const progress = calculateSubjectProgress(sourceItem.subjectId, sourceItem.classId, subject.totalPeriods, schedules);
          const currentRemaining = progress.remaining - previouslyAdded;
          
          if (currentRemaining > 0) {
            const nextDate = addDays(parseLocal(sourceItem.date), 7);
            const newDateStr = format(nextDate, 'yyyy-MM-dd');
            
            const exists = schedules.some(s => 
              s.classId === sourceItem.classId && 
              s.date === newDateStr && 
              s.startPeriod === sourceItem.startPeriod
            );

            if (!exists) {
              const periodsToTeach = Math.min(sourceItem.periodCount, currentRemaining);
              const newItem = {
                ...sourceItem,
                date: newDateStr,
                periodCount: periodsToTeach,
                status: ScheduleStatus.PENDING,
                id: generateId() 
              };
              const { id, ...itemWithoutId } = newItem;
              
              const conflict = checkConflict(itemWithoutId as any, schedules, subjects);
              if (!conflict.hasConflict) {
                addSchedule(itemWithoutId as any);
                addedCount++;
                addedPeriodsMap[key] = previouslyAdded + periodsToTeach;
              }
            }
          }
          
          const finalRemaining = progress.remaining - (addedPeriodsMap[key] || 0);
          const className = classes.find(c => c.id === sourceItem.classId)?.name;
          if (finalRemaining <= 4 && finalRemaining > 0) {
             const msg = `Lớp ${className}: Môn ${subject.name} sắp kết thúc (còn ${finalRemaining} tiết)`;
             if (!warnings.includes(msg)) warnings.push(msg);
          }
      });
    });

    if (warnings.length > 0) {
      alert(`Đã sao chép lịch!\n\nCảnh báo:\n${warnings.join('\n')}`);
    } else {
      alert(`Đã sao chép ${addedCount} buổi học sang tuần sau.`);
    }
    handleNextWeek();
  };

  const handleExportExcel = () => {
    // ... (Existing Excel Export Logic)
    const wb = XLSX.utils.book_new();
    const data: any[] = [];
    const merges: any[] = [];
    
    // 1. Header Row
    const header = ['Buổi', 'Tiết', ...weekDays.map(d => format(d, 'EEEE - dd/MM', { locale: vi }).toUpperCase())];
    data.push(header);

    // 2. Data Rows (Periods 1-10)
    PERIODS.forEach(p => {
        const sessionName = p === 1 ? 'Sáng' : (p === 6 ? 'Chiều' : '');
        const rowData: any[] = [sessionName, p];

        weekDays.forEach((day, dayIndex) => {
            const dateStr = format(day, 'yyyy-MM-dd');
            const item = filteredSchedules.find(s => s.date === dateStr && s.startPeriod <= p && (s.startPeriod + s.periodCount) > p);
            
            if (item) {
                if (item.startPeriod === p) {
                    const subj = subjects.find(s => s.id === item.subjectId);
                    const tea = teachers.find(t => t.id === item.teacherId);
                    const seqInfo = getSessionSequenceInfo(item, schedules, subj?.totalPeriods);
                    const displayCumulative = Math.min(seqInfo.cumulative, subj?.totalPeriods || seqInfo.cumulative);

                    let cellText = `${subj?.name}`;
                    if (item.status === ScheduleStatus.OFF) cellText += ` (NGHỈ)`;
                    else if (item.type === 'exam') cellText = `THI: ${subj?.name}`;
                    
                    cellText += `\nGV: ${tea?.name || '---'}`;
                    cellText += `\nPH: ${item.roomId}`;
                    cellText += `\nTiết: ${displayCumulative}/${subj?.totalPeriods}`;
                    
                    rowData.push(cellText);

                    // Add Merge for Multi-period classes
                    if (item.periodCount > 1) {
                        merges.push({
                            s: { r: p, c: dayIndex + 2 }, // Row index is 'p' because header is index 0
                            e: { r: p + item.periodCount - 1, c: dayIndex + 2 }
                        });
                    }
                } else {
                    rowData.push(null); 
                }
            } else {
                rowData.push('');
            }
        });
        data.push(rowData);
    });

    // 3. Footer
    data.push([]);
    const footer1 = ["Sáng:", "", "Tiết 1: 7h30 - 8h15   Tiết 2: 8h15 - 9h00   Ra chơi: 30 phút   Tiết 3: 9h30 - 10h15   Tiết 4: 10h15 - 11h00"];
    const footer2 = ["Chiều:", "", "Tiết 1: 13h15 - 14h00   Tiết 2: 14h00 - 14h45   Ra chơi: 15 phút   Tiết 3: 15h00 - 15h45   Tiết 4: 15h45 - 16h30"];
    data.push(footer1);
    data.push(footer2);

    const ws = XLSX.utils.aoa_to_sheet(data);

    // 4. Styling & Merges
    if(!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push({ s: { r: 1, c: 0 }, e: { r: 5, c: 0 } });
    ws['!merges'].push({ s: { r: 6, c: 0 }, e: { r: 10, c: 0 } });
    
    // Add dynamic class merges
    ws['!merges'].push(...merges);

    // Footer merges
    const footerRowStart = 12;
    ws['!merges'].push({ s: { r: footerRowStart, c: 2 }, e: { r: footerRowStart, c: 7 } });
    ws['!merges'].push({ s: { r: footerRowStart + 1, c: 2 }, e: { r: footerRowStart + 1, c: 7 } });

    // APPLY STYLES
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
    for (let R = range.s.r; R <= 10; ++R) { // Only style the grid part (Rows 0-10)
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellRef = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[cellRef]) continue;

            if (!ws[cellRef].s) ws[cellRef].s = {};

            // Default Style (Borders for Grid)
            ws[cellRef].s.font = { name: "Arial", sz: 10 };
            ws[cellRef].s.alignment = { wrapText: true, vertical: "center" };
            ws[cellRef].s.border = {
                top: { style: "thin", color: { rgb: "000000" } },
                bottom: { style: "thin", color: { rgb: "000000" } },
                left: { style: "thin", color: { rgb: "000000" } },
                right: { style: "thin", color: { rgb: "000000" } }
            };

            // 1. Headers (Row 0)
            if (R === 0) {
                ws[cellRef].s.font = { name: "Arial", sz: 10, bold: true };
                ws[cellRef].s.alignment = { horizontal: "center", vertical: "center", wrapText: true };
                ws[cellRef].s.fill = { fgColor: { rgb: "EEEEEE" } };
            }

            // 2. Buổi & Tiết Columns (Col 0, 1)
            if (C === 0 || C === 1) {
                ws[cellRef].s.font = { name: "Arial", sz: 10, bold: true };
                ws[cellRef].s.alignment = { horizontal: "center", vertical: "center", wrapText: true };
            }

            // 3. Afternoon Sessions (Rows 6-10) -> Color Blue
            if (R >= 6 && R <= 10) {
                 ws[cellRef].s.fill = { fgColor: { rgb: "DDEBF7" } };
            }
        }
    }

    ws['!cols'] = [
        { wch: 8 }, { wch: 5 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 25 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Lịch Học");
    XLSX.writeFile(wb, `Lich_Hoc_${classes.find(c => c.id === selectedClassId)?.name}_Tuan_${weekNumber}.xlsx`);
  };

  const handleExportInvitation = (item: any) => {
      // 1. Check for template
      const template = templates.find(t => t.type === 'invitation_word');
      if (!template) {
          alert("Vui lòng tải lên mẫu Thư mời giảng (.docx) trong phần 'Hệ thống' trước khi xuất file.");
          return;
      }

      try {
          // 2. Gather Data
          const teacher = teachers.find(t => t.id === item.teacherId);
          const currentClass = classes.find(c => c.id === item.classId);
          const subject = subjects.find(s => s.id === item.id); // item.id is subjectId in activeSubjectsSummary

          if (!teacher || !currentClass || !subject) {
              alert("Thiếu thông tin giáo viên, lớp hoặc môn học.");
              return;
          }

          // Get Schedules for this specific subject/class/teacher combo to determine dates and rooms
          const relevantSchedules = schedules
              .filter(s => s.subjectId === item.id && s.classId === item.classId && s.status !== ScheduleStatus.OFF)
              .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

          const startDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[0].date), 'dd/MM/yyyy') : '...';
          const endDate = relevantSchedules.length > 0 ? format(parseLocal(relevantSchedules[relevantSchedules.length - 1].date), 'dd/MM/yyyy') : '...';
          const datesStr = `Từ ngày ${startDate} đến ngày ${endDate}`;

          // Determine Sessions (Sáng/Chiều)
          const sessions = new Set<string>();
          relevantSchedules.forEach(s => {
              if (s.startPeriod <= 5) sessions.add("Sáng (1-5)");
              else sessions.add("Chiều (6-10)");
          });
          const sessionStr = Array.from(sessions).join(', ');

          // Determine Rooms
          const rooms = Array.from(new Set(relevantSchedules.map(s => s.roomId))).join(', ');

          // Determine Location & Map Link based on Class Name
          // Strip parentheses to handle names like "Class Name (1)"
          const cleanName = currentClass.name.trim().replace(/\)$/, '');
          const lastChar = cleanName.slice(-1);

          let location = "";
          let mapLink = "";

          if (lastChar === '1') {
             location = "Cơ sở 1 - số 79, ĐT743, phường Bình Hoà, TP.HCM";
             mapLink = "https://maps.app.goo.gl/Y9ubh6zCUp6USaun8";
          } else if (lastChar === '2') {
             location = "Cơ sở 2 - số 470, tổ 3, Ba Đình, phường Tân Đông Hiệp, TP.HCM";
             mapLink = "https://maps.app.goo.gl/8Vwf8gMnPuMGpNgA8";
          } else {
             location = "Cơ sở chính"; // Default fallback
             mapLink = "";
          }

          // Format Currency
          const rateStr = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(teacher.ratePerPeriod || 0);

          // 3. Prepare Data Object
          const data = {
              teacherTitle: teacher.title || 'Thầy/Cô', // NEW Variable
              teacherName: teacher.name,
              subjectName: subject.name,
              className: currentClass.name,
              totalPeriods: subject.totalPeriods,
              dates: datesStr,
              sessions: sessionStr,
              rate: rateStr,
              room: rooms,
              location: location,
              mapLink: mapLink
          };

          // 4. Generate Doc
          const zip = new PizZip(base64ToArrayBuffer(template.content));
          const doc = new Docxtemplater(zip, {
              paragraphLoop: true,
              linebreaks: true,
          });

          doc.render(data);

          const out = doc.getZip().generate({
              type: "blob",
              mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          });

          saveAs(out, `Thu_Moi_Giang_${teacher.name}_${subject.name}.docx`);

      } catch (error) {
          console.error(error);
          alert("Lỗi khi tạo file thư mời: " + error);
      }
  };

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-4 rounded-xl shadow-sm">
        <div className="flex items-center gap-2">
           <ListFilter size={20} className="text-gray-500" />
           <select 
             className="border rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
             value={selectedClassId}
             onChange={(e) => setSelectedClassId(e.target.value)}
           >
             {classes.map(c => <option key={c.id} value={c.id}>{c.name} ({c.studentCount} SV)</option>)}
           </select>
        </div>

        <div className="flex items-center gap-4">
          <button onClick={handlePrevWeek} className="p-2 hover:bg-gray-100 rounded-full"><ChevronLeft /></button>
          <div className="text-center">
            <p className="font-bold text-lg">Tuần {weekNumber}</p>
            <p className="text-xs text-gray-500">
                {format(weekStart, 'dd/MM')} - {format(addDays(weekStart, 6), 'dd/MM/yyyy')}
            </p>
          </div>
          <button onClick={handleNextWeek} className="p-2 hover:bg-gray-100 rounded-full"><ChevronRight /></button>
        </div>

        <div className="flex gap-2">
            <button 
                onClick={handleContinueNextWeek}
                className="flex items-center gap-2 px-3 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm font-medium"
            >
                <CalendarIcon size={16} /> Tiếp tục lịch tuần sau
            </button>
            <button 
                onClick={handleExportExcel}
                className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
            >
                <Download size={16} /> Xuất file lịch học
            </button>
            <button 
                onClick={() => { resetForm(); setShowAddModal(true); }}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
            >
                <Plus size={16} /> Thêm lịch
            </button>
        </div>
      </div>

      {/* Timetable Grid */}
      <div className="bg-white rounded-xl shadow overflow-x-auto relative">
        <table className="w-full min-w-[1000px] border-collapse">
          <thead>
            <tr className="bg-gray-100 text-gray-700 text-sm uppercase">
              <th className="border p-2 w-16">Buổi</th>
              <th className="border p-2 w-12">Tiết</th>
              {weekDays.map(d => (
                <th key={d.toString()} className="border p-2 min-w-[140px]">
                  <div className={`text-center ${isSameDay(d, new Date()) ? 'text-blue-600 font-bold' : ''}`}>
                    <div>{format(d, 'EEEE', { locale: vi })}</div>
                    <div className="text-xs font-normal text-gray-500">{format(d, 'dd/MM')}</div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-sm">
             {PERIODS.map((period, index) => {
               const isStartOfSession = period === 1 || period === 6;
               return (
                 <tr key={period} className="hover:bg-gray-50">
                   {isStartOfSession && (
                     <td rowSpan={5} className="border p-2 text-center font-bold bg-gray-50 writing-mode-vertical">
                       {getSessionFromPeriod(period)}
                     </td>
                   )}
                   <td className="border p-2 text-center font-semibold text-gray-500">{period}</td>
                   {weekDays.map(day => {
                     const dateStr = format(day, 'yyyy-MM-dd');
                     const item = filteredSchedules.find(s => s.date === dateStr && s.startPeriod === period);
                     const coveringItem = filteredSchedules.find(s => s.date === dateStr && s.startPeriod < period && (s.startPeriod + s.periodCount) > period);

                     if (coveringItem) return null;

                     if (!item) {
                       return (
                         <td 
                            key={day.toString()} 
                            className="border p-1 hover:bg-gray-100 transition-colors cursor-pointer"
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, day, period)}
                            onContextMenu={(e) => handleContextMenu(e, day, period)}
                            onDoubleClick={() => { 
                                resetForm(); 
                                setFormDate(format(day, 'yyyy-MM-dd')); 
                                setFormStartPeriod(period); 
                                setShowAddModal(true); 
                            }}
                         />
                       );
                     }

                     const subject = subjects.find(s => s.id === item.subjectId);
                     const teacher = teachers.find(t => t.id === item.teacherId);
                     const seqInfo = getSessionSequenceInfo(item, schedules, subject?.totalPeriods);
                     const displayCumulative = Math.min(seqInfo.cumulative, subject?.totalPeriods || seqInfo.cumulative);
                     
                     const computedStatus = determineStatus(item.date, item.startPeriod, item.status);

                     let bgColor = 'bg-blue-50 border-l-4 border-blue-500';
                     if (item.type === 'class') {
                        if (seqInfo.isFirst) bgColor = 'bg-orange-100 border-l-4 border-orange-500';
                        else if (seqInfo.isLast) bgColor = 'bg-red-100 border-l-4 border-red-500';
                     }
                     if (item.type === 'exam') bgColor = 'bg-yellow-50 border-l-4 border-yellow-500';
                     if (computedStatus === ScheduleStatus.OFF) bgColor = 'bg-gray-200 border-l-4 border-gray-500 opacity-70';
                     if (computedStatus === ScheduleStatus.MAKEUP) bgColor = 'bg-purple-50 border-l-4 border-purple-500';

                     return (
                       <td 
                         key={day.toString()} 
                         rowSpan={item.periodCount} 
                         className="border p-1 align-top relative group cursor-pointer hover:brightness-95 transition" 
                         onDoubleClick={() => { setEditItem(item); setShowAddModal(true); }}
                         draggable="true"
                         onDragStart={(e) => handleDragStart(e, item)}
                         onContextMenu={(e) => handleContextMenu(e, day, period, item)}
                       >
                         <div className={`h-full w-full p-2 rounded text-xs ${bgColor} flex flex-col justify-between ${draggedItem?.id === item.id ? 'opacity-50' : ''}`}>
                           <div>
                             <div className="font-bold text-gray-800 text-sm mb-1">{subject?.name}</div>
                             <div className="text-gray-600 mb-0.5"><span className="font-semibold">GV:</span> {teacher?.name || '---'}</div>
                             <div className="text-gray-600 mb-0.5"><span className="font-semibold">Phòng:</span> {item.roomId}</div>
                             {item.type === 'class' && (
                                <div className="text-gray-500 italic">Tiến độ: {displayCumulative}/{subject?.totalPeriods}</div>
                             )}
                           </div>
                           <div className="mt-2 pt-2 border-t border-black/10 flex justify-between items-center">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase text-white 
                                ${computedStatus === ScheduleStatus.COMPLETED ? 'bg-green-500' : 
                                  computedStatus === ScheduleStatus.PENDING ? 'bg-blue-400' :
                                  computedStatus === ScheduleStatus.ONGOING ? 'bg-orange-500' :
                                  computedStatus === ScheduleStatus.OFF ? 'bg-gray-500' : 'bg-purple-500'
                                }`}>
                                {computedStatus}
                              </span>
                           </div>
                         </div>
                       </td>
                     );
                   })}
                 </tr>
               );
             })}
          </tbody>
        </table>
      </div>

      {/* NEW: Active Subjects Summary & Invitation */}
      <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
         <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
            <BookOpen className="mr-2 text-blue-600" /> Môn học đang triển khai
         </h2>
         <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                 <thead className="bg-gray-50 border-b">
                     <tr>
                         <th className="p-3 w-12 text-center">STT</th>
                         <th className="p-3">Tên môn học</th>
                         <th className="p-3">Tên giáo viên</th>
                         <th className="p-3">Số tiết</th>
                         <th className="p-3">Lớp</th>
                         <th className="p-3 text-center">Thư mời giảng</th>
                     </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100">
                     {activeSubjectsSummary.length === 0 ? (
                         <tr>
                             <td colSpan={6} className="p-6 text-center text-gray-400 italic">Chưa có môn học nào được xếp lịch.</td>
                         </tr>
                     ) : (
                         activeSubjectsSummary.map((item, index) => (
                             <tr key={item.id} className="hover:bg-gray-50">
                                 <td className="p-3 text-center text-gray-500">{index + 1}</td>
                                 <td className="p-3 font-medium text-gray-800">{item.subjectName}</td>
                                 <td className="p-3 text-gray-600">{item.teacherName}</td>
                                 <td className="p-3 text-gray-600">{item.totalPeriods}</td>
                                 <td className="p-3 text-gray-600">{item.className}</td>
                                 <td className="p-3 text-center">
                                     <button 
                                        onClick={() => handleExportInvitation(item)}
                                        className="inline-flex items-center px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded hover:bg-blue-50 transition-colors shadow-sm text-xs font-medium"
                                     >
                                         <Mail size={14} className="mr-1.5" /> Xuất thư mời
                                     </button>
                                 </td>
                             </tr>
                         ))
                     )}
                 </tbody>
             </table>
         </div>
      </div>

      {/* Context Menu */}
      {contextMenu.show && (
        <div 
            className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 w-48 animate-in fade-in zoom-in-95 duration-100"
            style={{ top: contextMenu.y, left: contextMenu.x }}
        >
            {contextMenu.target?.item ? (
                <button 
                    onClick={handleCopy}
                    className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center text-sm text-gray-700"
                >
                    <Copy size={16} className="mr-2" /> Sao chép buổi học
                </button>
            ) : (
                <button 
                    onClick={handlePaste}
                    disabled={!copiedItem}
                    className={`w-full text-left px-4 py-2 flex items-center text-sm ${
                        copiedItem 
                        ? 'hover:bg-gray-100 text-gray-700' 
                        : 'text-gray-400 cursor-not-allowed'
                    }`}
                >
                    <Clipboard size={16} className="mr-2" /> Dán vào ô này
                </button>
            )}
            
            {copiedItem && contextMenu.target?.item === undefined && (
                <div className="px-4 py-1 text-xs text-gray-400 border-t mt-1">
                   Đã sao chép 1 buổi.
                </div>
            )}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b flex justify-between items-center bg-gray-50 shrink-0">
              <h3 className="font-bold text-lg">{editItem ? 'Điều chỉnh lịch' : 'Thêm lịch mới'}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-red-500"><X /></button>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto">
              {formError && (
                 <div className="bg-red-50 text-red-600 p-3 rounded flex items-center text-sm">
                   <AlertCircle size={16} className="mr-2" /> {formError}
                 </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Loại lịch</label>
                    <select 
                        value={editItem ? editItem.type : formType} 
                        onChange={(e) => {
                            if (!editItem) {
                                const val = e.target.value as 'class' | 'exam';
                                setFormType(val);
                                // Auto-select teacher if exam and subject is already selected
                                if (val === 'exam' && formSubjectId) {
                                    const suggested = getTeacherForSubject(formSubjectId, selectedClassId);
                                    if (suggested) setFormTeacherId(suggested);
                                }
                            }
                        }} 
                        disabled={!!editItem} 
                        className="w-full border rounded p-2"
                    >
                        <option value="class">Lịch học</option>
                        <option value="exam">Lịch thi</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Lớp chính</label>
                    <input type="text" value={classes.find(c => c.id === selectedClassId)?.name} disabled className="w-full border rounded p-2 bg-gray-100" />
                  </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div>
                    <label className="block text-sm font-medium mb-1">Ngày dạy</label>
                    <input type="date" value={editItem ? editItem.date : formDate} onChange={(e) => editItem ? setEditItem({...editItem, date: e.target.value}) : setFormDate(e.target.value)} className="w-full border rounded p-2" />
                 </div>
                 <div>
                    <label className="block text-sm font-medium mb-1">Giáo viên</label>
                    <select 
                        value={editItem ? editItem.teacherId : formTeacherId} 
                        onChange={(e) => editItem ? setEditItem({...editItem, teacherId: e.target.value}) : setFormTeacherId(e.target.value)} 
                        className="w-full border rounded p-2"
                    >
                        <option value="">Chọn giáo viên...</option>
                        {suggestedTeachers.length > 0 && (
                            <optgroup label="Giáo viên phụ trách">
                                {suggestedTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </optgroup>
                        )}
                        <optgroup label={suggestedTeachers.length > 0 ? "Giáo viên khác" : "Danh sách giáo viên"}>
                            {otherTeachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                        </optgroup>
                    </select>
                 </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Môn học</label>
                <select 
                    value={editItem ? editItem.subjectId : formSubjectId} 
                    onChange={(e) => {
                        const val = e.target.value;
                        
                        // Auto-detect teacher
                        let autoTeacherId = '';
                        const selectedSub = subjects.find(s => s.id === val);
                        
                        if (selectedSub) {
                             const t1 = teachers.find(t => t.name.toLowerCase().trim() === selectedSub.teacher1?.toLowerCase().trim());
                             if (t1) autoTeacherId = t1.id;
                             else {
                                 const t2 = teachers.find(t => t.name.toLowerCase().trim() === selectedSub.teacher2?.toLowerCase().trim());
                                 if (t2) autoTeacherId = t2.id;
                             }
                        }
                        
                        const isExam = editItem ? editItem.type === 'exam' : formType === 'exam';
                        const clsId = editItem ? editItem.classId : selectedClassId;
                        if (isExam && val) {
                            const historyTeacher = getTeacherForSubject(val, clsId);
                            if (historyTeacher) autoTeacherId = historyTeacher;
                        }
                
                        if (editItem) {
                            setEditItem({ ...editItem, subjectId: val, teacherId: autoTeacherId });
                        } else {
                            setFormSubjectId(val);
                            setFormTeacherId(autoTeacherId);
                        }
                    }} 
                    className="w-full border rounded p-2"
                >
                    <option value="">Chọn môn học...</option>
                    {availableSubjects.map(s => <option key={s.id} value={s.id}>{s.name} ({s.totalPeriods} tiết)</option>)}
                </select>
              </div>

              {/* NEW: Multi-Select for Shared Subjects */}
              {isFormSubjectShared && !editItem && (
                  <div className="bg-blue-50 p-3 rounded border border-blue-200">
                    <label className="block text-sm font-bold mb-2 text-blue-800 flex items-center">
                        <Users size={16} className="mr-2"/> Chọn các lớp học ghép (Môn chung)
                    </label>
                    <div className="grid grid-cols-2 gap-2 max-h-32 overflow-y-auto pr-2 custom-scrollbar">
                        {classes.map(cls => (
                            <label key={cls.id} className={`flex items-center space-x-2 text-sm p-2 rounded cursor-pointer ${selectedSharedClasses.includes(cls.id) ? 'bg-blue-100' : 'hover:bg-white'}`}>
                                <input
                                    type="checkbox"
                                    className="rounded text-blue-600 focus:ring-blue-500"
                                    checked={selectedSharedClasses.includes(cls.id)}
                                    disabled={cls.id === selectedClassId} // Current class is mandatory
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedSharedClasses([...selectedSharedClasses, cls.id]);
                                        } else {
                                            setSelectedSharedClasses(selectedSharedClasses.filter(id => id !== cls.id));
                                        }
                                    }}
                                />
                                <span className={cls.id === selectedClassId ? 'font-bold' : ''}>{cls.name}</span>
                            </label>
                        ))}
                    </div>
                  </div>
              )}

              <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Tiết bắt đầu</label>
                    <select 
                        value={editItem ? editItem.startPeriod : formStartPeriod} 
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            const maxSession = val <= 5 ? 6 - val : 11 - val;
                            
                            if (editItem) {
                                // Adjust count if it exceeds new max
                                const newCount = Math.min(editItem.periodCount, maxSession);
                                setEditItem({...editItem, startPeriod: val, periodCount: newCount});
                            } else {
                                const newCount = Math.min(formPeriodCount, maxSession);
                                setFormStartPeriod(val);
                                setFormPeriodCount(newCount);
                            }
                        }} 
                        className="w-full border rounded p-2"
                    >
                        {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                   <div>
                    <label className="block text-sm font-medium mb-1">Số tiết</label>
                    <input 
                        type="number" 
                        min="1" 
                        max={(() => {
                            const start = editItem ? editItem.startPeriod : formStartPeriod;
                            return start <= 5 ? 6 - start : 11 - start;
                        })()}
                        value={editItem ? editItem.periodCount : formPeriodCount} 
                        onChange={(e) => {
                            let val = Number(e.target.value);
                            const start = editItem ? editItem.startPeriod : formStartPeriod;
                            const maxSession = start <= 5 ? 6 - start : 11 - start;
                            
                            if (val > maxSession) val = maxSession;

                            const subjId = editItem ? editItem.subjectId : formSubjectId;
                            const type = editItem ? editItem.type : formType;

                            if (type === 'class' && subjId) {
                                const subject = subjects.find(s => s.id === subjId);
                                if (subject) {
                                    const used = schedules.filter(s =>
                                        s.subjectId === subjId &&
                                        s.classId === selectedClassId &&
                                        s.status !== ScheduleStatus.OFF &&
                                        (editItem ? s.id !== editItem.id : true)
                                    ).reduce((acc, curr) => acc + curr.periodCount, 0);

                                    const remaining = Math.max(0, subject.totalPeriods - used);
                                    if (val > remaining) {
                                        alert(`Môn học chỉ còn ${remaining} tiết`);
                                        val = remaining;
                                    }
                                }
                            }

                            if (editItem) setEditItem({...editItem, periodCount: val});
                            else setFormPeriodCount(val);
                        }} 
                        className="w-full border rounded p-2" 
                    />
                  </div>
                   <div>
                    <label className="block text-sm font-medium mb-1">Phòng học</label>
                    <input type="text" value={editItem ? editItem.roomId : formRoom} onChange={(e) => editItem ? setEditItem({...editItem, roomId: e.target.value}) : setFormRoom(e.target.value)} className="w-full border rounded p-2" />
                  </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Ghi chú</label>
                <input 
                    type="text" 
                    value={editItem ? (editItem.note || '') : formNote} 
                    onChange={(e) => editItem ? setEditItem({...editItem, note: e.target.value}) : setFormNote(e.target.value)} 
                    placeholder="Ví dụ: Thi thực hành, ..." 
                    className="w-full border rounded p-2" 
                />
              </div>

              {editItem && (
                  <div className="bg-yellow-50 p-3 rounded border border-yellow-200">
                      <label className="block text-sm font-bold mb-2 text-yellow-800">Trạng thái & Điều chỉnh</label>
                      <div className="flex flex-wrap gap-2">
                          {Object.values(ScheduleStatus).map(status => (
                              <button 
                                key={status}
                                onClick={() => handleStatusChange(status)}
                                className={`px-2 py-1 rounded text-xs border ${editItem.status === status ? 'bg-yellow-500 text-white border-yellow-600' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
                              >
                                  {status}
                              </button>
                          ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                          *Chọn "Nghỉ" để đánh dấu buổi nghỉ. Chọn "Tiết bổ sung" cho lịch bù.
                      </p>
                  </div>
              )}
            </div>

            <div className="p-4 border-t bg-gray-50 flex justify-between shrink-0">
              {editItem ? (
                 <button onClick={handleDeleteItem} className="text-red-600 hover:bg-red-50 px-3 py-2 rounded flex items-center">
                    <Trash2 size={16} className="mr-1" /> Xóa
                 </button>
              ) : <div></div>}
              
              <div className="flex gap-2">
                  <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded">Hủy</button>
                  <button onClick={handleSaveSchedule} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center">
                    <Save size={16} className="mr-2" /> Lưu
                  </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScheduleManager;
