import { ScheduleItem, ScheduleStatus, Subject } from './types';
import { isSameDay } from 'date-fns';

export const generateId = () => Math.random().toString(36).substr(2, 9);

export const getSessionFromPeriod = (startPeriod: number): 'Sáng' | 'Chiều' | 'Tối' => {
  if (startPeriod <= 5) return 'Sáng';
  if (startPeriod <= 10) return 'Chiều';
  return 'Tối';
};

// Helper for parsing YYYY-MM-DD to Local Date
export const parseLocal = (dateStr: string): Date => {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-');
  if (parts.length !== 3) return new Date();
  const [y, m, d] = parts.map(Number);
  return new Date(y, m - 1, d);
};

// Conflict Checker
export const checkConflict = (
  newItem: Omit<ScheduleItem, 'id' | 'status'>,
  existingItems: ScheduleItem[],
  subjects: Subject[], // NEW: Pass subjects list to check for isShared
  excludeId?: string
): { hasConflict: boolean; message: string } => {
  const newItemEnd = newItem.startPeriod + newItem.periodCount;
  
  // Find current subject details
  const currentSubject = subjects.find(s => s.id === newItem.subjectId);
  const isNewItemShared = !!currentSubject?.isShared;

  for (const item of existingItems) {
    if (excludeId && item.id === excludeId) continue;
    if (item.status === ScheduleStatus.OFF) continue; // Ignored cancelled classes

    if (isSameDay(parseLocal(item.date), parseLocal(newItem.date))) {
      const itemEnd = item.startPeriod + item.periodCount;
      
      // Check time overlap
      // (StartA < EndB) and (EndA > StartB)
      const overlap = (newItem.startPeriod < itemEnd) && (newItemEnd > item.startPeriod);

      if (overlap) {
        // 1. Absolute rule: Cannot schedule the EXACT SAME subject for the EXACT SAME class at the same time.
        // This prevents accidental double-entries, which is likely a mistake even for shared subjects.
        if (item.classId === newItem.classId && item.subjectId === newItem.subjectId) {
             return { hasConflict: true, message: `Lớp này đã có lịch môn này vào giờ này rồi.` };
        }

        // Shared Subject Logic:
        // If the subject is marked as 'Shared', we ignore other conflict rules ONLY IF
        // the existing item is ALSO the same shared subject instance (Same Subject, Same Teacher, Same Room).
        if (isNewItemShared) {
            const isSameSharedInstance = 
                item.subjectId === newItem.subjectId &&
                item.teacherId === newItem.teacherId &&
                item.roomId === newItem.roomId;

            if (isSameSharedInstance) {
                // This is a sibling class in the same shared session. Allow overlap.
                continue; 
            }
            // If it's a shared subject but different teacher/room, fall through to standard checks.
        }

        // Standard Checks for Normal Subjects (or non-matching Shared Subjects)
        if (item.roomId === newItem.roomId) {
             return { hasConflict: true, message: `Trùng phòng học: ${item.roomId} đã có lớp.` };
        }
        if (item.teacherId === newItem.teacherId) {
             return { hasConflict: true, message: `Trùng giáo viên: GV này đang dạy lớp khác.` };
        }
        if (item.classId === newItem.classId) {
             return { hasConflict: true, message: `Trùng lịch học của lớp: Lớp này đang học môn khác.` };
        }
        
        // Specific check for exams vs class
        if (item.type === 'exam' && newItem.type === 'class' && item.classId === newItem.classId) {
             return { hasConflict: true, message: `Lớp có lịch thi vào giờ này.` };
        }
        if (item.type === 'class' && newItem.type === 'exam' && item.classId === newItem.classId) {
             return { hasConflict: true, message: `Lớp có lịch học vào giờ này.` };
        }
      }
    }
  }

  return { hasConflict: false, message: '' };
};

export const calculateSubjectProgress = (
  subjectId: string, 
  classId: string, 
  totalPeriods: number, 
  schedules: ScheduleItem[]
) => {
  const learned = schedules
    .filter(s => s.subjectId === subjectId && s.classId === classId && s.status !== ScheduleStatus.OFF)
    .reduce((acc, curr) => acc + curr.periodCount, 0);
  
  return {
    learned,
    total: totalPeriods,
    percentage: Math.min(100, Math.round((learned / totalPeriods) * 100)),
    remaining: Math.max(0, totalPeriods - learned)
  };
};

// NEW: Helper to get sequence info (cumulative progress, isFirst, isLast)
export const getSessionSequenceInfo = (
  currentItem: ScheduleItem,
  allSchedules: ScheduleItem[],
  totalPeriods: number = 0
) => {
  // 1. Get all valid sessions for this subject & class
  const relevantItems = allSchedules.filter(s => 
    s.subjectId === currentItem.subjectId && 
    s.classId === currentItem.classId && 
    s.status !== ScheduleStatus.OFF &&
    s.type === 'class'
  ).sort((a, b) => {
    // Sort by Date then by Start Period
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    if (dateA !== dateB) return dateA - dateB;
    return a.startPeriod - b.startPeriod;
  });

  // 2. Find index of current item
  const index = relevantItems.findIndex(s => s.id === currentItem.id);
  
  if (index === -1) {
    return { cumulative: 0, isFirst: false, isLast: false };
  }

  // 3. Calculate cumulative progress up to this item
  let cumulative = 0;
  for (let i = 0; i <= index; i++) {
    cumulative += relevantItems[i].periodCount;
  }

  // Determine First/Last based on logical accumulation logic
  // First: If the periods BEFORE this session was 0
  const previousCumulative = cumulative - relevantItems[index].periodCount;
  const isFirst = previousCumulative === 0;

  // Last: If this session reaches or exceeds the total periods (if provided) 
  // OR if it's strictly the last item in the array and we assume the schedule is complete.
  // Using >= totalPeriods is safer for display highlighting.
  const isLast = (totalPeriods > 0 && cumulative >= totalPeriods) || (index === relevantItems.length - 1 && totalPeriods > 0 && cumulative >= totalPeriods);

  return {
    cumulative,
    isFirst,
    isLast
  };
};

export const determineStatus = (dateStr: string, startPeriod: number, currentStatus: ScheduleStatus): ScheduleStatus => {
  // Respect manual overrides for OFF and MAKEUP
  if (currentStatus === ScheduleStatus.OFF || currentStatus === ScheduleStatus.MAKEUP) {
    return currentStatus;
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const classDate = parseLocal(dateStr);
  classDate.setHours(0, 0, 0, 0);
  
  if (classDate < today) return ScheduleStatus.COMPLETED;
  if (classDate > today) return ScheduleStatus.PENDING;

  // If dates are equal
  return ScheduleStatus.ONGOING;
};