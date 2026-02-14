import React, { useState, useRef, useMemo } from 'react';
import { useApp } from '../store/AppContext';
import { Student } from '../types';
import { Plus, Trash2, Edit2, Upload, Save, X, Filter, User, HelpCircle, FileSpreadsheet, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import *as XLSX from 'xlsx';
import { format } from 'date-fns';
import { parseLocal } from '../utils';

const StudentManager: React.FC = () => {
  const { classes, students, majors, addStudent, updateStudent, deleteStudent, importStudents } = useApp();
  const [selectedClassId, setSelectedClassId] = useState<string>(classes[0]?.id || '');
  
  const [showModal, setShowModal] = useState(false);
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Student>>({});
  
  // Sorting state: 'asc' (A-Z), 'desc' (Z-A), or 'default' (insertion order)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | 'default'>('default');
  const [searchTerm, setSearchTerm] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filter students by selected class
  const filteredStudents = students.filter(s => {
      const matchesClass = s.classId === selectedClassId;
      if (!matchesClass) return false;
      
      if (!searchTerm) return true;
      const term = searchTerm.toLowerCase();
      return s.name.toLowerCase().includes(term) || s.studentCode.toLowerCase().includes(term);
  });
  
  const currentClass = classes.find(c => c.id === selectedClassId);

  // Sorting Logic
  const sortedStudents = useMemo(() => {
    if (sortOrder === 'default') return filteredStudents;

    // Helper to split name into [LastName+MiddleName, FirstName]
    // Vietnamese sorting usually prioritizes First Name, then Last Name
    const getNameParts = (fullName: string) => {
        const parts = fullName.trim().split(' ');
        const firstName = parts.pop() || '';
        const lastName = parts.join(' ');
        return { firstName: firstName.toLowerCase(), lastName: lastName.toLowerCase() };
    };

    return [...filteredStudents].sort((a, b) => {
        const nameA = getNameParts(a.name);
        const nameB = getNameParts(b.name);

        // 1. Compare First Name
        const firstCompare = nameA.firstName.localeCompare(nameB.firstName, 'vi');
        if (firstCompare !== 0) {
            return sortOrder === 'asc' ? firstCompare : -firstCompare;
        }

        // 2. Compare Last Name (if First Names are identical)
        const lastCompare = nameA.lastName.localeCompare(nameB.lastName, 'vi');
        return sortOrder === 'asc' ? lastCompare : -lastCompare;
    });
  }, [filteredStudents, sortOrder]);

  const toggleSort = () => {
      if (sortOrder === 'default') setSortOrder('asc');
      else if (sortOrder === 'asc') setSortOrder('desc');
      else setSortOrder('default');
  };

  const handleOpenAdd = () => {
    setFormData({ 
        classId: selectedClassId,
        studentCode: '',
        name: '', dob: '', pob: '', fatherName: '', motherName: '', phone: '' 
    });
    setEditingStudentId(null);
    setShowModal(true);
  };

  const handleOpenEdit = (student: Student) => {
    setFormData(student);
    setEditingStudentId(student.id);
    setShowModal(true);
  };

  const handleSave = () => {
    if (!formData.name || !formData.classId) {
        alert("Vui lòng nhập tên học sinh!");
        return;
    }

    const studentData: any = {
        studentCode: formData.studentCode || '',
        name: formData.name,
        classId: formData.classId,
        dob: formData.dob || '',
        pob: formData.pob || '',
        fatherName: formData.fatherName || '',
        motherName: formData.motherName || '',
        phone: formData.phone || ''
    };

    if (editingStudentId) {
        updateStudent(editingStudentId, studentData);
    } else {
        addStudent(studentData);
    }
    setShowModal(false);
  };

  const handleImportClick = () => {
      fileInputRef.current?.click();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset immediately to prevent input freezing
    e.target.value = '';

    const reader = new FileReader();
    reader.onload = (evt) => {
        try {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const wsname = wb.SheetNames[0];
            const ws = wb.Sheets[wsname];
            const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
            
            if (!data || data.length < 2) {
                setTimeout(() => alert("File Excel rỗng hoặc không đúng định dạng!"), 100);
                return;
            }

            // Remove header row
            const rows = data.slice(1) as any[]; 
            
            // Map data to Student structure (Col 0: Code, Col 1: Name, Col 2: DOB, Col 3: POB, Col 4: Father, Col 5: Mother, Col 6: Phone)
            const newStudents: Omit<Student, 'id'>[] = rows.map(row => ({
                classId: selectedClassId,
                studentCode: row[0] ? String(row[0]) : '',
                name: row[1] || '',
                dob: row[2] ? String(row[2]) : '',
                pob: row[3] ? String(row[3]) : '',
                fatherName: row[4] ? String(row[4]) : '',
                motherName: row[5] ? String(row[5]) : '',
                phone: row[6] ? String(row[6]) : ''
            })).filter(s => s.name); // Filter empty rows

            if (newStudents.length > 0) {
                importStudents(newStudents);
                setTimeout(() => alert(`Đã nhập thành công ${newStudents.length} học sinh.`), 100);
            } else {
                setTimeout(() => alert("Không tìm thấy dữ liệu hợp lệ trong file Excel."), 100);
            }
        } catch (error) {
            console.error(error);
            setTimeout(() => alert("Lỗi khi đọc file Excel. Vui lòng kiểm tra lại định dạng file."), 100);
        }
    };
    reader.readAsBinaryString(file);
  };

  const handleExportClassList = () => {
    if (!currentClass) return;
    const currentMajor = majors.find(m => m.id === currentClass.majorId);
    
    // Create new Workbook
    const wb = XLSX.utils.book_new();
    const wsData = [];

    // 1. Title
    // Merged Center Title "DANH SÁCH HỌC SINH"
    wsData.push(["", "", "DANH SÁCH HỌC SINH"]); 
    wsData.push([""]); // Spacer

    // 2. Info Section (Left and Right)
    // Row 2
    wsData.push(["Môn:", "", "", "Khóa học:", currentClass.schoolYear]);
    // Row 3
    wsData.push(["Lớp:", currentClass.name, "", "Bậc đào tạo:", "Trung cấp chuyên nghiệp"]);
    // Row 4
    wsData.push(["Ngành:", currentMajor?.name || "", "", "Loại hình đào tạo:", "Chính quy"]);
    wsData.push([""]); // Spacer

    // 3. Table Header
    // Columns: STT, MSSV, Họ, Tên, Ngày sinh, Ghi chú
    wsData.push(["STT", "MSSV", "Họ", "Tên", "Ngày sinh", "Ghi chú"]);

    // 4. Data Rows
    // Use sortedStudents for export as well if user wants the sorted list
    sortedStudents.forEach((s, index) => {
        // Split name into Last Name (Họ) and First Name (Tên)
        const parts = s.name.trim().split(' ');
        const firstName = parts.length > 0 ? parts[parts.length - 1] : '';
        const lastName = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
        
        let dobStr = s.dob;
        try { dobStr = format(parseLocal(s.dob), 'dd/MM/yyyy'); } catch {}

        wsData.push([
            index + 1,
            s.studentCode,
            lastName,
            firstName,
            dobStr,
            "" // Ghi chú empty
        ]);
    });

    // Add some empty rows if list is small to look good
    if (sortedStudents.length < 5) {
        for(let i=0; i< (5 - sortedStudents.length); i++) {
            wsData.push([sortedStudents.length + i + 1, "", "", "", "", ""]);
        }
    }

    // Create Sheet
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // 5. Apply Merges
    if (!ws['!merges']) ws['!merges'] = [];
    ws['!merges'].push(
        // Title Span (Center roughly over cols C-D)
        { s: { r: 0, c: 2 }, e: { r: 0, c: 4 } },
        
        // Info Section Right side spans (Training info often takes more space)
        // Row 3 "Trung cấp..."
        { s: { r: 3, c: 4 }, e: { r: 3, c: 5 } },
        // Row 4 "Chính quy"
        { s: { r: 4, c: 4 }, e: { r: 4, c: 5 } }
    );

    // 6. Column Widths
    ws['!cols'] = [
        { wch: 5 },  // STT
        { wch: 12 }, // MSSV
        { wch: 25 }, // Họ
        { wch: 10 }, // Tên
        { wch: 15 }, // Ngày sinh
        { wch: 20 }  // Ghi chú
    ];

    XLSX.utils.book_append_sheet(wb, ws, "DanhSachHocSinh");
    XLSX.writeFile(wb, `DanhSach_${currentClass.name}.xlsx`);
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800">Quản lý Học sinh - Sinh viên</h1>

      {/* Toolbar */}
      <div className="bg-white p-4 rounded-xl shadow border border-blue-100 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto flex-1">
            <div className="flex items-center gap-3 w-full md:w-auto">
                <Filter size={20} className="text-blue-600" />
                <span className="font-semibold text-gray-700 whitespace-nowrap">Chọn lớp:</span>
                <select 
                    className="border p-2 rounded outline-none focus:ring-2 focus:ring-blue-500 w-full md:w-[250px] bg-gray-50"
                    value={selectedClassId}
                    onChange={(e) => setSelectedClassId(e.target.value)}
                >
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
            </div>

            <div className="relative w-full md:w-64">
                <Search size={18} className="text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input 
                    type="text" 
                    placeholder="Tìm tên hoặc mã HS..." 
                    className="w-full border p-2 pl-9 rounded outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && (
                    <button onClick={() => setSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                        <X size={14} />
                    </button>
                )}
            </div>
        </div>

        <div className="flex gap-2">
            <input 
                type="file" 
                accept=".xlsx, .xls" 
                ref={fileInputRef} 
                className="hidden" 
                onChange={handleFileUpload} 
            />
            <button 
                onClick={handleImportClick}
                className="flex items-center gap-2 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition text-sm"
            >
                <Upload size={16} /> Nhập Excel
            </button>
            <button 
                onClick={handleOpenAdd}
                className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition text-sm"
            >
                <Plus size={16} /> Thêm mới
            </button>
            <button 
                onClick={handleExportClassList}
                className="flex items-center gap-2 px-3 py-2 bg-orange-600 text-white rounded hover:bg-orange-700 transition text-sm"
            >
                <FileSpreadsheet size={16} /> Danh sách lớp
            </button>
        </div>
      </div>

      <div className="bg-blue-50 text-blue-800 p-3 rounded text-xs flex items-center border border-blue-200">
         <HelpCircle size={16} className="mr-2" />
         <span>Lưu ý file Excel nhập liệu: Dòng 1 là tiêu đề. Các cột theo thứ tự: <strong>Mã HS | Họ tên | Ngày sinh | Nơi sinh | Bố | Mẹ | Điện thoại</strong></span>
      </div>

      {/* Student List */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
            <h2 className="font-bold text-gray-700">Danh sách lớp: {currentClass?.name}</h2>
            <span className="text-sm text-gray-500">Sĩ số: {sortedStudents.length} / {currentClass?.studentCount}</span>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
                <thead className="bg-gray-100 text-gray-600 uppercase">
                    <tr>
                        <th className="p-3 border-b">STT</th>
                        <th className="p-3 border-b">Mã HS</th>
                        <th 
                            className="p-3 border-b cursor-pointer hover:bg-gray-200 transition-colors select-none flex items-center gap-1 group"
                            onClick={toggleSort}
                            title="Bấm để sắp xếp theo tên"
                        >
                            Họ tên
                            {sortOrder === 'default' && <ArrowUpDown size={14} className="text-gray-400 group-hover:text-gray-600" />}
                            {sortOrder === 'asc' && <ArrowUp size={14} className="text-blue-600" />}
                            {sortOrder === 'desc' && <ArrowDown size={14} className="text-blue-600" />}
                        </th>
                        <th className="p-3 border-b">Ngày sinh</th>
                        <th className="p-3 border-b">Nơi sinh</th>
                        <th className="p-3 border-b">Phụ huynh</th>
                        <th className="p-3 border-b">Liên hệ</th>
                        <th className="p-3 border-b text-center">Hành động</th>
                    </tr>
                </thead>
                <tbody className="divide-y">
                    {sortedStudents.length === 0 ? (
                        <tr>
                            <td colSpan={8} className="p-8 text-center text-gray-400 italic">
                                {searchTerm 
                                    ? `Không tìm thấy học sinh nào phù hợp với "${searchTerm}".` 
                                    : "Chưa có học sinh nào trong lớp này. Hãy thêm mới hoặc nhập từ Excel."}
                            </td>
                        </tr>
                    ) : (
                        sortedStudents.map((s, index) => (
                            <tr key={s.id} className="hover:bg-blue-50 transition">
                                <td className="p-3 text-center text-gray-500">{index + 1}</td>
                                <td className="p-3 font-semibold text-blue-600">{s.studentCode}</td>
                                <td className="p-3 font-medium text-gray-800">{s.name}</td>
                                <td className="p-3">
                                    {s.dob ? (() => {
                                        try {
                                            return format(parseLocal(s.dob), 'dd/MM/yyyy');
                                        } catch {
                                            return s.dob;
                                        }
                                    })() : ''}
                                </td>
                                <td className="p-3">{s.pob}</td>
                                <td className="p-3">
                                    <div className="text-xs">
                                        {s.fatherName && <div><span className="font-semibold text-gray-500">Bố:</span> {s.fatherName}</div>}
                                        {s.motherName && <div><span className="font-semibold text-gray-500">Mẹ:</span> {s.motherName}</div>}
                                    </div>
                                </td>
                                <td className="p-3 text-blue-600">{s.phone}</td>
                                <td className="p-3">
                                    <div className="flex justify-center gap-2">
                                        <button onClick={() => handleOpenEdit(s)} className="p-1 text-orange-500 hover:bg-orange-100 rounded" title="Sửa">
                                            <Edit2 size={16} />
                                        </button>
                                        <button onClick={() => deleteStudent(s.id)} className="p-1 text-red-500 hover:bg-red-100 rounded" title="Xóa">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))
                    )}
                </tbody>
            </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
                <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
                    <h3 className="font-bold text-lg flex items-center gap-2">
                        <User size={20} className="text-blue-600" />
                        {editingStudentId ? 'Cập nhật thông tin' : 'Thêm học sinh mới'}
                    </h3>
                    <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="md:col-span-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Mã học sinh</label>
                            <input 
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={formData.studentCode || ''} 
                                onChange={e => setFormData({...formData, studentCode: e.target.value})}
                                placeholder="Nhập mã HS..."
                            />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Họ và tên <span className="text-red-500">*</span></label>
                            <input 
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={formData.name || ''} 
                                onChange={e => setFormData({...formData, name: e.target.value})}
                                placeholder="Nhập họ tên..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Ngày sinh</label>
                            <input 
                                type="date"
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={formData.dob || ''} 
                                onChange={e => setFormData({...formData, dob: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Nơi sinh</label>
                            <input 
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={formData.pob || ''} 
                                onChange={e => setFormData({...formData, pob: e.target.value})}
                                placeholder="Tỉnh/Thành phố..."
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Họ tên Bố</label>
                            <input 
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={formData.fatherName || ''} 
                                onChange={e => setFormData({...formData, fatherName: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Họ tên Mẹ</label>
                            <input 
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={formData.motherName || ''} 
                                onChange={e => setFormData({...formData, motherName: e.target.value})}
                            />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Số điện thoại liên hệ</label>
                            <input 
                                className="w-full border p-2 rounded focus:ring-2 focus:ring-blue-500 outline-none" 
                                value={formData.phone || ''} 
                                onChange={e => setFormData({...formData, phone: e.target.value})}
                                placeholder="Nhập số điện thoại..."
                            />
                        </div>
                    </div>
                </div>

                <div className="p-4 border-t bg-gray-50 flex justify-end gap-2">
                    <button onClick={() => setShowModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-200 rounded">Hủy</button>
                    <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-2">
                        <Save size={18} /> Lưu thông tin
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

export default StudentManager;
