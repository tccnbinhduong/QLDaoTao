import React, { useRef } from 'react';
import { useApp } from '../store/AppContext';
import { AppState } from '../types';
import { Download, Upload, RefreshCcw, FileJson, Settings } from 'lucide-react';
import { format } from 'date-fns';

const SystemManager: React.FC = () => {
  const { 
    teachers, subjects, majors, classes, schedules, students, documents, // Access all data for backup
    loadData, resetData 
  } = useApp();
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Backup Handler
  const handleBackup = () => {
      const data: AppState = { teachers, subjects, majors, classes, schedules, students, documents };
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `EduPro_Backup_${format(new Date(), 'dd-MM-yyyy')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
  };

  const handleRestoreClick = () => {
      fileInputRef.current?.click();
  };

  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (evt) => {
          try {
              const json = evt.target?.result as string;
              const data = JSON.parse(json) as AppState;
              loadData(data);
              alert("Khôi phục dữ liệu thành công!");
          } catch (error) {
              alert("Lỗi: File dữ liệu không hợp lệ.");
          }
          if (fileInputRef.current) fileInputRef.current.value = '';
      };
      reader.readAsText(file);
  };

  const handleResetWithBackup = () => {
      const confirmMsg = "CẢNH BÁO QUAN TRỌNG:\n\nBạn đang thực hiện xóa toàn bộ dữ liệu hệ thống. Hành động này không thể hoàn tác.\n\nĐể đảm bảo an toàn, hệ thống sẽ tự động lưu một bản dự phòng dữ liệu hiện tại trước khi xóa.\n\nBạn có chắc chắn muốn tiếp tục?";
      if (window.confirm(confirmMsg)) {
          // 1. Auto Backup
          handleBackup();
          
          // 2. Reset with delay to ensure download starts
          setTimeout(() => {
              resetData();
              alert("Đã sao lưu dữ liệu và reset hệ thống về mặc định.");
          }, 500);
      }
  };

  return (
    <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-800">Hệ thống & Cấu hình</h1>

        <div className="bg-white p-6 rounded shadow border border-blue-100">
            <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center">
                <Settings className="mr-2 text-blue-600" /> Sao lưu và Khôi phục dữ liệu
            </h2>
            <p className="text-gray-600 mb-6">
                Vì ứng dụng chạy trực tiếp trên trình duyệt của máy cá nhân, việc sao lưu dữ liệu là rất quan trọng để tránh mất mát khi xóa lịch sử trình duyệt hoặc đổi máy tính.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Backup Section */}
                <div className="border border-green-200 bg-green-50 p-6 rounded-lg">
                    <h3 className="font-bold text-green-800 mb-2 flex items-center">
                            <Download className="mr-2" size={20}/> 1. Sao lưu dữ liệu (Backup)
                    </h3>
                    <p className="text-sm text-green-700 mb-4">
                        Tải toàn bộ dữ liệu hiện tại (Giáo viên, Lịch, Học sinh...) về máy tính dưới dạng file .JSON.
                    </p>
                    <button 
                        onClick={handleBackup}
                        className="bg-green-600 text-white px-4 py-2 rounded shadow hover:bg-green-700 flex items-center"
                    >
                        <FileJson className="mr-2" size={18} /> Tải file sao lưu
                    </button>
                </div>

                {/* Restore Section */}
                <div className="border border-blue-200 bg-blue-50 p-6 rounded-lg">
                    <h3 className="font-bold text-blue-800 mb-2 flex items-center">
                            <Upload className="mr-2" size={20}/> 2. Khôi phục dữ liệu (Restore)
                    </h3>
                    <p className="text-sm text-blue-700 mb-4">
                        Chọn file .JSON đã sao lưu để khôi phục lại dữ liệu. <br/>
                        <span className="font-bold text-red-500">Lưu ý: Dữ liệu hiện tại sẽ bị ghi đè hoàn toàn.</span>
                    </p>
                    <input 
                        type="file" 
                        accept=".json" 
                        ref={fileInputRef} 
                        className="hidden" 
                        onChange={handleRestoreFile} 
                    />
                    <button 
                        onClick={handleRestoreClick}
                        className="bg-blue-600 text-white px-4 py-2 rounded shadow hover:bg-blue-700 flex items-center"
                    >
                        <Upload className="mr-2" size={18} /> Chọn file để khôi phục
                    </button>
                </div>
            </div>

            <div className="mt-8 pt-6 border-t">
                <h3 className="font-bold text-red-600 mb-2 flex items-center">
                    <RefreshCcw className="mr-2" size={18} /> Vùng nguy hiểm
                </h3>
                <button 
                    onClick={handleResetWithBackup}
                    className="text-red-500 border border-red-200 hover:bg-red-50 px-4 py-2 rounded transition"
                >
                    Xóa toàn bộ dữ liệu & Reset về mặc định
                </button>
            </div>
        </div>
    </div>
  );
};

export default SystemManager;