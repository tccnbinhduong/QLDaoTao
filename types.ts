
export type Period = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type Session = 'Sáng' | 'Chiều' | 'Tối';

export enum ScheduleStatus {
  PENDING = 'Sắp học',
  ONGOING = 'Đang học',
  COMPLETED = 'Đã học',
  MAKEUP = 'Tiết bổ sung',
  OFF = 'Nghỉ'
}

export interface Teacher {
  id: string;
  name: string;
  phone: string;
  accountNumber: string;
  bank: string;
  mainSubject: string; // ID of the subject they usually teach
  ratePerPeriod: number;
}

export interface Subject {
  id: string;
  name: string;
  majorId: string; // Industry/Major
  totalPeriods: number;
  isShared?: boolean; // NEW: Flag for shared subjects (Combined classes)
  // Responsible teachers
  teacher1?: string;
  phone1?: string;
  teacher2?: string;
  phone2?: string;
  teacher3?: string;
  phone3?: string;
}

export interface ClassEntity {
  id: string;
  name: string;
  studentCount: number;
  majorId: string;
  schoolYear: string;
}

export interface Student {
  id: string;
  studentCode: string; // New field
  classId: string;
  name: string;
  dob: string; // YYYY-MM-DD
  pob: string; // Place of birth
  fatherName: string;
  motherName: string;
  phone: string;
}

export interface ScheduleItem {
  id: string;
  type: 'class' | 'exam';
  teacherId: string;
  subjectId: string;
  classId: string;
  roomId: string;
  date: string; // ISO Date string YYYY-MM-DD
  session: Session;
  startPeriod: number;
  periodCount: number;
  status: ScheduleStatus;
  note?: string;
}

export interface Major {
  id: string;
  name: string;
}

// New Document Type
export interface DocumentItem {
  id: string;
  name: string;
  type: 'word' | 'excel' | 'pdf' | 'other';
  size: number;
  uploadDate: string; // ISO String
  content: string; // Base64 Data URL
}

// Stats types
export interface TeacherStat {
  teacherId: string;
  teacherName: string;
  totalPeriods: number;
  totalIncome: number;
  history: { date: string; periods: number; className: string }[];
}

// NEW: Template Type for Export
export interface ExportTemplate {
  id: string;
  name: string;
  type: 'payment_word'; // Can be extended
  content: string; // Base64 Data URL
}

// Global App State Interface
export interface AppState {
  teachers: Teacher[];
  subjects: Subject[];
  classes: ClassEntity[];
  students: Student[];
  schedules: ScheduleItem[];
  majors: Major[];
  documents: DocumentItem[];
  templates: ExportTemplate[]; // NEW
}