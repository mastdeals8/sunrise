import React, { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGlobalDate } from "../contexts/GlobalDateContext";
import { normalizeDisplayName } from "../../../shared/textFormat";
import { 
  Users, 
  Clock, 
  Plus, 
  MapPin, 
  CreditCard, 
  CheckCircle, 
  AlertCircle,
  FileText,
  Trash2,
  Edit,
  Calculator,
  Calendar,
  IndianRupee,
  UserCheck,
  Check,
  X,
  TrendingDown
} from "lucide-react";

interface User {
  id: number;
  employeeId: string;
  name: string;
  role: string;
  email: string;
  phone: string | null;
  telegramChatId?: string | null;
  department: string | null;
  designation: string | null;
  joiningDate: string | null;
  basicSalary: number;
  dailyWage: number;
  advanceBalance: number;
  bankAccountNumber: string | null;
  ifscCode: string | null;
  address: string | null;
  emergencyContact: string | null;
  emergencyContactPhone: string | null;
  notes: string | null;
  isActive: boolean;
}

interface Attendance {
  id: number;
  userId: number;
  date: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  workingHours: number;
  overtimeHours: number;
  status: string;
  leaveType: string | null;
  notes: string | null;
  approvedBy: number | null;
}

interface Advance {
  id: number;
  userId: number;
  amount: number;
  date: string;
  paymentMode: string;
  reason: string | null;
  proofUrl: string | null;
  isAdjusted: boolean;
}

interface Payroll {
  id: number;
  userId: number;
  month: number;
  year: number;
  basicSalary: number;
  dailyWage: number;
  presentDays: number;
  halfDays: number;
  absentDays: number;
  overtimePay: number;
  advancesPaid: number;
  deductions: number;
  netSalary: number;
  status: string;
  approvedBy: number | null;
}

const StaffPage: React.FC = () => {
  const { token, user: currentUser } = useAuth();
  const globalDate = useGlobalDate();
  const [activeTab, setActiveTab] = useState<"attendance" | "sheet" | "directory" | "advances" | "payroll">("attendance");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [errMessage, setErrMessage] = useState("");

  // Data lists
  const [usersList, setUsersList] = useState<User[]>([]);
  const [attendanceList, setAttendanceList] = useState<Attendance[]>([]);
  const [advancesList, setAdvancesList] = useState<Advance[]>([]);
  const [payrollList, setPayrollList] = useState<Payroll[]>([]);

  // Month & Year select
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingStaffId, setEditingStaffId] = useState<number | null>(null);

  // Staff Master Fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [role, setRole] = useState("staff");
  const [department, setDepartment] = useState("");
  const [designation, setDesignation] = useState("");
  const [joiningDate, setJoiningDate] = useState("");
  const [basicSalary, setBasicSalary] = useState("0");
  const [dailyWage, setDailyWage] = useState("0");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContact, setEmergencyContact] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [staffNotes, setStaffNotes] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Today Clock Console States
  const [clockStaffId, setClockStaffId] = useState<number | null>(null);
  const [attStatus, setAttStatus] = useState("present");
  const [leaveType, setLeaveType] = useState("sick");
  const [notes, setNotes] = useState("");
  const [clockHours, setClockHours] = useState("8");
  const [clockOvertime, setClockOvertime] = useState("0");
  const [clockApprovedBy, setClockApprovedBy] = useState("");

  // Advances Form States
  const [advStaffId, setAdvStaffId] = useState("");
  const [advAmount, setAdvAmount] = useState("");
  const [advDate, setAdvDate] = useState(new Date().toISOString().split("T")[0]);
  const [advMode, setAdvMode] = useState("cash");
  const [advReason, setAdvReason] = useState("");

  // Payroll Form States
  const [proBasicSalary, setProBasicSalary] = useState<Record<number, string>>({});
  const [proDailyWage, setProDailyWage] = useState<Record<number, string>>({});
  const [proPresentDays, setProPresentDays] = useState<Record<number, string>>({});
  const [proHalfDays, setProHalfDays] = useState<Record<number, string>>({});
  const [proAbsentDays, setProAbsentDays] = useState<Record<number, string>>({});
  const [proOvertimePay, setProOvertimePay] = useState<Record<number, string>>({});
  const [proAdvancesPaid, setProAdvancesPaid] = useState<Record<number, string>>({});
  const [proDeductions, setProDeductions] = useState<Record<number, string>>({});

  const showSuccess = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(""), 4000);
  };

  const showError = (msg: string) => {
    setErrMessage(msg);
    setTimeout(() => setErrMessage(""), 4000);
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      const headers = { Authorization: `Bearer ${token}` };

      // Users
      const resU = await fetch("/api/users", { headers });
      if (resU.ok) setUsersList(await resU.json());

      // Attendance
      const resA = await fetch("/api/attendance", { headers });
      if (resA.ok) {
        const rows = await resA.json();
        setAttendanceList(rows.filter((row: Attendance) => globalDate.isInRange(row.date)));
      }

      // Advances
      const resAd = await fetch("/api/advances", { headers });
      if (resAd.ok) {
        const rows = await resAd.json();
        setAdvancesList(rows.filter((row: Advance) => globalDate.isInRange(row.date)));
      }

      // Payroll
      const resP = await fetch(`/api/payroll?month=${selectedMonth}&year=${selectedYear}`, { headers });
      if (resP.ok) setPayrollList(await resP.json());

    } catch (err) {
      console.error("Error fetching staff payroll details:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [globalDate.range.end, globalDate.range.start, token, selectedMonth, selectedYear]);

  // Handle Staff Save (Create / Update)
  const handleSaveStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) return;

    try {
      const payload: any = {
        name: normalizeDisplayName(name),
        email,
        phone: phone || null,
        telegramChatId: telegramChatId || null,
        role,
        department: normalizeDisplayName(department) || null,
        designation: normalizeDisplayName(designation) || null,
        joiningDate: joiningDate ? new Date(joiningDate).toISOString() : null,
        basicSalary: Number(basicSalary) || 0,
        dailyWage: Number(dailyWage) || 0,
        bankAccountNumber: bankAccountNumber || null,
        ifscCode: ifscCode || null,
        address: address || null,
        emergencyContact: normalizeDisplayName(emergencyContact) || null,
        emergencyContactPhone: emergencyContactPhone || null,
        notes: staffNotes || null,
        isActive
      };

      let res;
      if (editingStaffId) {
        // Update
        res = await fetch(`/api/users/${editingStaffId}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
      } else {
        // Create (Register)
        if (!username || !password) {
          showError("Username and password are required for new staff enrollment.");
          return;
        }
        res = await fetch("/api/auth/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            ...payload,
            username,
            password
          })
        });
      }

      if (res.ok) {
        showSuccess(`Staff member successfully ${editingStaffId ? "updated" : "enrolled"}!`);
        setShowAddForm(false);
        setEditingStaffId(null);
        clearStaffForm();
        fetchData();
      } else {
        const err = await res.json();
        showError(err.message || "Failed to save staff profile.");
      }
    } catch (err) {
      showError("Staff database transaction failed.");
    }
  };

  const clearStaffForm = () => {
    setUsername("");
    setPassword("");
    setName("");
    setEmail("");
    setPhone("");
    setTelegramChatId("");
    setRole("staff");
    setDepartment("");
    setDesignation("");
    setJoiningDate("");
    setBasicSalary("0");
    setDailyWage("0");
    setBankAccountNumber("");
    setIfscCode("");
    setAddress("");
    setEmergencyContact("");
    setEmergencyContactPhone("");
    setStaffNotes("");
    setIsActive(true);
  };

  const handleEditStaff = (staff: User) => {
    setEditingStaffId(staff.id);
    setName(staff.name);
    setEmail(staff.email);
    setPhone(staff.phone || "");
    setTelegramChatId(staff.telegramChatId || "");
    setRole(staff.role);
    setDepartment(staff.department || "");
    setDesignation(staff.designation || "");
    setJoiningDate(staff.joiningDate ? staff.joiningDate.split("T")[0] : "");
    setBasicSalary(staff.basicSalary.toString());
    setDailyWage(staff.dailyWage.toString());
    setBankAccountNumber(staff.bankAccountNumber || "");
    setIfscCode(staff.ifscCode || "");
    setAddress(staff.address || "");
    setEmergencyContact(staff.emergencyContact || "");
    setEmergencyContactPhone(staff.emergencyContactPhone || "");
    setStaffNotes(staff.notes || "");
    setIsActive(staff.isActive);
    setShowAddForm(true);
  };

  // Clock attendance touch console logic
  const handleClockSubmit = async (action: "in" | "out") => {
    if (!clockStaffId) return;

    try {
      const payload: any = {
        userId: clockStaffId,
        date: new Date().toISOString(),
        status: attStatus,
        notes: notes || null,
        workingHours: Number(clockHours) || 0,
        overtimeHours: Number(clockOvertime) || 0,
        approvedBy: clockApprovedBy ? Number(clockApprovedBy) : null
      };

      if (action === "in") {
        payload.checkInTime = new Date().toISOString();
        if (attStatus === "leave") {
          payload.leaveType = leaveType;
        }
      } else {
        payload.checkOutTime = new Date().toISOString();
      }

      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        showSuccess(`Shift check-${action === "in" ? "in" : "out"} logged successfully!`);
        setNotes("");
        setClockOvertime("0");
        fetchData();
      } else {
        showError("Failed to save shift attendance.");
      }
    } catch (err) {
      console.error("Attendance post error:", err);
    }
  };

  // Advance Cash Issue Logic
  const handleIssueAdvance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!advStaffId || !advAmount) return;

    try {
      const res = await fetch("/api/advances", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          userId: Number(advStaffId),
          amount: Number(advAmount),
          date: new Date(advDate).toISOString(),
          paymentMode: advMode,
          reason: advReason || null,
          isAdjusted: false
        })
      });

      if (res.ok) {
        showSuccess(`Salary Advance of ₹${Number(advAmount).toLocaleString()} issued successfully!`);
        setAdvStaffId("");
        setAdvAmount("");
        setAdvReason("");
        fetchData();
      } else {
        showError("Deduction voucher issue failed.");
      }
    } catch (err) {
      console.error("Advance transaction failed:", err);
    }
  };

  // Auto-Calculate Payroll from Attendance and Seed values
  const handleCalculatePayroll = (staff: User) => {
    // Filter attendance records of the staff for selected Month & Year
    const staffAtt = attendanceList.filter(a => {
      const d = new Date(a.date);
      return a.userId === staff.id && (d.getMonth() + 1) === selectedMonth && d.getFullYear() === selectedYear;
    });

    const presentDays = staffAtt.filter(a => a.status === "present" || a.status === "overtime").length;
    const halfDays = staffAtt.filter(a => a.status === "half_day").length;
    const absentDays = staffAtt.filter(a => a.status === "absent").length;
    
    // Sum total overtime hours
    const totalOTHours = staffAtt.reduce((sum, a) => sum + (a.overtimeHours || 0), 0);
    
    // Default hourly OT rate = (salary / 30 / 8) * 1.5
    const hourlyOTRate = staff.basicSalary > 0 ? 
      Math.round(((staff.basicSalary / 30) / 8) * 1.5) : 150;
    const overtimePay = totalOTHours * hourlyOTRate;

    // Pro-rata Monthly Salary Calculation
    let earnedSalary = 0;
    if (staff.dailyWage > 0) {
      earnedSalary = (staff.dailyWage * presentDays) + ((staff.dailyWage * 0.5) * halfDays);
    } else {
      // 30 day basic pro-rata
      const baseEarned = (staff.basicSalary / 30) * presentDays;
      const halfEarned = (staff.basicSalary / 30) * 0.5 * halfDays;
      earnedSalary = Math.round(baseEarned + halfEarned);
    }

    // Auto set input states
    const uid = staff.id;
    setProBasicSalary(prev => ({ ...prev, [uid]: staff.basicSalary.toString() }));
    setProDailyWage(prev => ({ ...prev, [uid]: staff.dailyWage.toString() }));
    setProPresentDays(prev => ({ ...prev, [uid]: presentDays.toString() }));
    setProHalfDays(prev => ({ ...prev, [uid]: halfDays.toString() }));
    setProAbsentDays(prev => ({ ...prev, [uid]: absentDays.toString() }));
    setProOvertimePay(prev => ({ ...prev, [uid]: overtimePay.toString() }));
    setProAdvancesPaid(prev => ({ ...prev, [uid]: Math.min(staff.advanceBalance, earnedSalary).toString() }));
    setProDeductions(prev => ({ ...prev, [uid]: "0" }));
  };

  const handlePostPayroll = async (staff: User) => {
    const uid = staff.id;
    const basic = Number(proBasicSalary[uid]) || staff.basicSalary;
    const daily = Number(proDailyWage[uid]) || staff.dailyWage;
    const present = Number(proPresentDays[uid]) || 0;
    const half = Number(proHalfDays[uid]) || 0;
    const absent = Number(proAbsentDays[uid]) || 0;
    const ot = Number(proOvertimePay[uid]) || 0;
    const adv = Number(proAdvancesPaid[uid]) || 0;
    const deduct = Number(proDeductions[uid]) || 0;

    let gross = 0;
    if (daily > 0) {
      gross = (daily * present) + (daily * 0.5 * half);
    } else {
      gross = Math.round(((basic / 30) * present) + ((basic / 30) * 0.5 * half));
    }

    const net = Math.max(0, gross + ot - adv - deduct);

    try {
      // Check if record already exists for this staff/month/year
      const existing = payrollList.find(p => p.userId === staff.id && p.month === selectedMonth && p.year === selectedYear);

      let res;
      if (existing) {
        res = await fetch(`/api/payroll/${existing.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            basicSalary: basic,
            dailyWage: daily,
            presentDays: present,
            halfDays: half,
            absentDays: absent,
            overtimePay: ot,
            advancesPaid: adv,
            deductions: deduct,
            netSalary: net,
            status: "draft"
          })
        });
      } else {
        res = await fetch("/api/payroll", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            userId: staff.id,
            month: selectedMonth,
            year: selectedYear,
            basicSalary: basic,
            dailyWage: daily,
            presentDays: present,
            halfDays: half,
            absentDays: absent,
            overtimePay: ot,
            advancesPaid: adv,
            deductions: deduct,
            netSalary: net,
            status: "draft"
          })
        });
      }

      if (res.ok) {
        showSuccess(`Payroll sheet compiled for "${staff.name}" successfully!`);
        fetchData();
      } else {
        showError("Failed to compile payroll entry.");
      }
    } catch (err) {
      console.error("Payroll post failed:", err);
    }
  };

  const handlePayPayroll = async (payrollEntry: Payroll, staffName: string) => {
    try {
      const res = await fetch(`/api/payroll/${payrollEntry.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          status: "paid"
        })
      });

      if (res.ok) {
        showSuccess(`Salary disbursed to "${staffName}" and advance balances resolved!`);
        fetchData();
      }
    } catch (err) {
      console.error("Disbursement failure:", err);
    }
  };

  const formatCurrency = (val: number) => {
    return "₹" + val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Helper lists
  const monthNames = [
    "January", "February", "March", "April", "May", "June", 
    "July", "August", "September", "October", "November", "December"
  ];
  const yearList = [2024, 2025, 2026, 2027];
  const adminsAndManagers = usersList.filter(u => u.role === "admin" || u.role === "manager");

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  // Active select staff
  const activeClockStaff = usersList.find(u => u.id === clockStaffId);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Staff & Touch Attendance</h1>
          <p className="text-slate-500 text-sm mt-1">Enroll personnel, log clock shift entries, advance wages, and calculate monthly payroll statements.</p>
        </div>
      </div>

      {message && (
        <div className="p-3 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg font-semibold flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-600" />
          {message}
        </div>
      )}

      {errMessage && (
        <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-600" />
          {errMessage}
        </div>
      )}

      {/* Tabs Layout */}
      <div className="flex border-b border-slate-200 overflow-x-auto pb-1 whitespace-nowrap bg-white p-2 rounded-xl shadow-sm">
        <button
          onClick={() => { setActiveTab("attendance"); setMessage(""); }}
          className={`pb-2 px-5 text-sm font-bold transition flex items-center gap-2 border-b-2 ${activeTab === "attendance" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Clock className="w-4 h-4" />
          Touch Shift Console
        </button>
        <button
          onClick={() => { setActiveTab("sheet"); setMessage(""); }}
          className={`pb-2 px-5 text-sm font-bold transition flex items-center gap-2 border-b-2 ${activeTab === "sheet" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Calendar className="w-4 h-4" />
          Monthly Roster Sheet
        </button>
        <button
          onClick={() => { setActiveTab("directory"); setMessage(""); }}
          className={`pb-2 px-5 text-sm font-bold transition flex items-center gap-2 border-b-2 ${activeTab === "directory" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Users className="w-4 h-4" />
          Staff Master Directory
        </button>
        <button
          onClick={() => { setActiveTab("advances"); setMessage(""); }}
          className={`pb-2 px-5 text-sm font-bold transition flex items-center gap-2 border-b-2 ${activeTab === "advances" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <TrendingDown className="w-4 h-4" />
          Advances Ledger
        </button>
        <button
          onClick={() => { setActiveTab("payroll"); setMessage(""); }}
          className={`pb-2 px-5 text-sm font-bold transition flex items-center gap-2 border-b-2 ${activeTab === "payroll" ? "border-orange-500 text-orange-600" : "border-transparent text-slate-500 hover:text-slate-800"}`}
        >
          <Calculator className="w-4 h-4" />
          Salary Calculation
        </button>
      </div>

      {/* 1. TOUCH ATTENDANCE SHIFT CONSOLE */}
      {activeTab === "attendance" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 glass-panel space-y-4">
            <h3 className="font-bold text-slate-800 text-md">1. Select Staff Member</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {usersList.map((staff) => {
                const selected = clockStaffId === staff.id;
                return (
                  <button
                    key={staff.id}
                    onClick={() => { setClockStaffId(staff.id); setMessage(""); }}
                    className={`p-4 rounded-xl border text-left flex flex-col justify-between transition-all ${selected ? "bg-orange-600 border-orange-600 text-white shadow-md" : "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100/60"}`}
                  >
                    <span className={`text-[10px] font-bold uppercase tracking-wider block mb-2 ${selected ? "text-orange-100" : "text-slate-400"}`}>{staff.employeeId || "SUN-000"}</span>
                    <span className="text-sm font-black truncate block w-full">{staff.name}</span>
                    <span className={`text-[10px] font-semibold mt-1 block truncate ${selected ? "text-orange-200" : "text-orange-600"}`}>{staff.designation || "Creative Editor"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="glass-panel space-y-5">
            <h3 className="font-bold text-slate-800 text-md">2. Register Shift Clock</h3>
            {activeClockStaff ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-orange-500 to-amber-500 flex items-center justify-center font-bold text-white shadow-sm mx-auto mb-2 text-lg uppercase">
                    {activeClockStaff.name.slice(0, 2)}
                  </div>
                  <h4 className="text-sm font-bold text-slate-800">{activeClockStaff.name}</h4>
                  <span className="text-xs text-orange-600 font-semibold uppercase">{activeClockStaff.employeeId}</span>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Shift Status</label>
                  <select
                    value={attStatus}
                    onChange={(e) => setAttStatus(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
                  >
                    <option value="present">Present (Full Day)</option>
                    <option value="late">Late (Grace hours)</option>
                    <option value="half_day">Half Day Shift</option>
                    <option value="leave">On Leave</option>
                    <option value="absent">Absent</option>
                    <option value="overtime">Overtime Shift</option>
                  </select>
                </div>

                {attStatus === "leave" && (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Leave Type</label>
                    <select
                      value={leaveType}
                      onChange={(e) => setLeaveType(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
                    >
                      <option value="sick">Sick Leave</option>
                      <option value="casual">Casual Leave</option>
                      <option value="emergency">Emergency / Maternity</option>
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Working Hours</label>
                    <input
                      type="number"
                      required
                      value={clockHours}
                      onChange={(e) => setClockHours(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Overtime Hours</label>
                    <input
                      type="number"
                      value={clockOvertime}
                      onChange={(e) => setClockOvertime(e.target.value)}
                      className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Shift Approved By</label>
                  <select
                    value={clockApprovedBy}
                    onChange={(e) => setClockApprovedBy(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm"
                  >
                    <option value="">Select Authorizer</option>
                    {adminsAndManagers.map(adm => (
                      <option key={adm.id} value={adm.id}>{adm.name} ({adm.role})</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Shift Work Notes</label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-orange-500 text-sm resize-none"
                    placeholder="Enter work details, check-in notes..."
                  ></textarea>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => handleClockSubmit("in")}
                    className="py-2.5 px-4 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg transition text-xs uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Clock In
                  </button>
                  <button
                    onClick={() => handleClockSubmit("out")}
                    className="py-2.5 px-4 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg transition text-xs uppercase tracking-wider flex items-center justify-center gap-1 shadow-sm"
                  >
                    <Clock className="w-4 h-4" />
                    Clock Out
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-400 border border-dashed border-slate-200 rounded-xl p-4">
                <Users className="w-8 h-8 mx-auto text-slate-300 mb-2" />
                <p className="text-xs">Please tap on a staff member on the left panel to trigger check-in operations.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. MONTHLY ATTENDANCE SHEET GRID */}
      {activeTab === "sheet" && (
        <div className="glass-panel space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="font-bold text-slate-800 text-lg">Monthly Roster Sheet</h3>
              <p className="text-xs text-slate-500 mt-0.5">Click any grid cell to update or override daily attendance logs.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none"
              >
                {monthNames.map((name, i) => (
                  <option key={i} value={i + 1}>{name}</option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none"
              >
                {yearList.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-slate-600 uppercase font-black tracking-wide border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 sticky left-0 bg-slate-50 z-10 border-r border-slate-200 min-w-[150px]">Staff Name</th>
                  {Array.from({ length: new Date(selectedYear, selectedMonth, 0).getDate() }).map((_, idx) => (
                    <th key={idx} className="px-2 py-3 text-center border-r border-slate-200">{idx + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {usersList.map((staff) => (
                  <tr key={staff.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 sticky left-0 bg-white font-bold text-slate-900 border-r border-slate-200 sticky-cell-shadow">
                      <div className="flex flex-col">
                        <span className="truncate">{staff.name}</span>
                        <span className="text-[9px] text-slate-400 font-semibold uppercase">{staff.employeeId}</span>
                      </div>
                    </td>
                    {Array.from({ length: new Date(selectedYear, selectedMonth, 0).getDate() }).map((_, idx) => {
                      const dayNum = idx + 1;
                      const dateStr = `${selectedYear}-${selectedMonth.toString().padStart(2, '0')}-${dayNum.toString().padStart(2, '0')}`;
                      const record = attendanceList.find(a => {
                        const recD = new Date(a.date).toISOString().split("T")[0];
                        return a.userId === staff.id && recD === dateStr;
                      });

                      let displayVal = "-";
                      let colorClass = "text-slate-300";
                      if (record) {
                        if (record.status === "present") { displayVal = "P"; colorClass = "bg-green-100 text-green-800 border-green-200 font-black"; }
                        else if (record.status === "half_day") { displayVal = "½"; colorClass = "bg-yellow-100 text-yellow-800 border-yellow-200 font-black"; }
                        else if (record.status === "absent") { displayVal = "A"; colorClass = "bg-red-100 text-red-800 border-red-200 font-black"; }
                        else if (record.status === "leave") { displayVal = "L"; colorClass = "bg-blue-100 text-blue-800 border-blue-200 font-black"; }
                        else if (record.status === "overtime") { displayVal = "OT"; colorClass = "bg-purple-100 text-purple-800 border-purple-200 font-black"; }
                        else { displayVal = record.status.slice(0, 1).toUpperCase(); colorClass = "bg-slate-100 text-slate-800"; }
                      }

                      return (
                        <td key={idx} className="p-1 border-r border-slate-200 text-center">
                          <select
                            value={record?.status || "none"}
                            onChange={async (e) => {
                              const selectVal = e.target.value;
                              if (selectVal === "none") return;
                              try {
                                await fetch("/api/attendance", {
                                  method: "POST",
                                  headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${token}`
                                  },
                                  body: JSON.stringify({
                                    userId: staff.id,
                                    date: new Date(selectedYear, selectedMonth - 1, dayNum).toISOString(),
                                    status: selectVal,
                                    workingHours: 8,
                                    approvedBy: currentUser?.id
                                  })
                                });
                                fetchData();
                              } catch (err) {
                                console.error("Override attendance error:", err);
                              }
                            }}
                            className={`w-10 h-8 rounded border text-center text-[10px] leading-none focus:outline-none appearance-none cursor-pointer ${colorClass}`}
                          >
                            <option value="none" className="bg-white text-slate-400">-</option>
                            <option value="present" className="bg-white text-green-700">P</option>
                            <option value="half_day" className="bg-white text-yellow-700">½</option>
                            <option value="absent" className="bg-white text-red-700">A</option>
                            <option value="leave" className="bg-white text-blue-700">L</option>
                            <option value="overtime" className="bg-white text-purple-700">OT</option>
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. STAFF MASTER DIRECTORY (ADMIN STAFF ADD/EDIT) */}
      {activeTab === "directory" && (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-slate-800 text-lg">Staff Master Directory</h3>
            <button
              onClick={() => { setShowAddForm(!showAddForm); setEditingStaffId(null); clearStaffForm(); }}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition"
            >
              <Plus className="w-4 h-4" />
              {showAddForm ? "View Roster List" : "Add Staff Profile"}
            </button>
          </div>

          {showAddForm ? (
            <form onSubmit={handleSaveStaff} className="glass-panel max-w-4xl mx-auto space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Credentials - New Staff only */}
                {!editingStaffId && (
                  <>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Username</label>
                      <input
                        type="text"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                        placeholder="jdoe"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Password</label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                        placeholder="••••••••"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Staff Full Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    placeholder="Rohit Kumar"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Corporate Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    placeholder="rohit@sunrisemedia.in"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Mobile Contact Phone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    placeholder="+91 9876543210"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Telegram Chat ID</label>
                  <input
                    type="text"
                    value={telegramChatId}
                    onChange={(e) => setTelegramChatId(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    placeholder="e.g. 123456789 (for ERP field-link delivery)"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Designation Role</label>
                  <select
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  >
                    <option value="staff">Staff / Creative Executive</option>
                    <option value="manager">Operations Manager</option>
                    <option value="admin">System Director</option>
                    <option value="accounts">Accounts Incharge</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Department</label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    placeholder="Creative, Marketing, Printing"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Detailed Designation</label>
                  <input
                    type="text"
                    value={designation}
                    onChange={(e) => setDesignation(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                    placeholder="ACP Fabrication Supervisor"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date of Joining</label>
                  <input
                    type="date"
                    value={joiningDate}
                    onChange={(e) => setJoiningDate(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Monthly Base Salary (₹)</label>
                  <input
                    type="number"
                    value={basicSalary}
                    onChange={(e) => setBasicSalary(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Daily Wage (if applicable) (₹)</label>
                  <input
                    type="number"
                    value={dailyWage}
                    onChange={(e) => setDailyWage(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bank Account Number</label>
                  <input
                    type="text"
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">IFSC Code</label>
                  <input
                    type="text"
                    value={ifscCode}
                    onChange={(e) => setIfscCode(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Emergency Contact Person</label>
                  <input
                    type="text"
                    value={emergencyContact}
                    onChange={(e) => setEmergencyContact(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Emergency Phone Number</label>
                  <input
                    type="text"
                    value={emergencyContactPhone}
                    onChange={(e) => setEmergencyContactPhone(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Complete Roster Address</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Roster Active Status</label>
                  <select
                    value={isActive ? "true" : "false"}
                    onChange={(e) => setIsActive(e.target.value === "true")}
                    className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
                  >
                    <option value="true">Active Personnel</option>
                    <option value="false">Suspended / Deactivated</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Personnel Notes</label>
                <textarea
                  rows={2}
                  value={staffNotes}
                  onChange={(e) => setStaffNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none resize-none"
                  placeholder="Important payroll details, shift bindings, custom deductions..."
                ></textarea>
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  className="py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition"
                >
                  Save Profile
                </button>
              </div>
            </form>
          ) : (
            <div className="glass-panel overflow-hidden border border-slate-200">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-700">
                  <thead className="bg-slate-50 text-slate-600 uppercase font-black tracking-wide border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4">Employee ID</th>
                      <th className="px-6 py-4">Name</th>
                      <th className="px-6 py-4">Mobile</th>
                      <th className="px-6 py-4">Department / Designation</th>
                      <th className="px-6 py-4">Emergency Contact</th>
                      <th className="px-6 py-4 text-right">Wage Info</th>
                      <th className="px-6 py-4 text-center">Status</th>
                      <th className="px-6 py-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white">
                    {usersList.map((staff) => (
                      <tr key={staff.id} className="hover:bg-slate-50/50 transition">
                        <td className="px-6 py-4 font-mono text-orange-600 text-xs font-black">{staff.employeeId}</td>
                        <td className="px-6 py-4">
                          <div className="font-extrabold text-slate-900">{staff.name}</div>
                          <div className="text-xs text-slate-400">{staff.email}</div>
                        </td>
                        <td className="px-6 py-4 text-slate-600 font-semibold">{staff.phone || "-"}</td>
                        <td className="px-6 py-4 text-slate-500">
                          <div className="font-bold">{staff.department || "-"}</div>
                          <div className="text-xs text-orange-600">{staff.designation || "-"}</div>
                        </td>
                        <td className="px-6 py-4 text-xs text-slate-500">
                          {staff.emergencyContact ? (
                            <div>
                              <div>{staff.emergencyContact}</div>
                              <div className="font-semibold text-slate-400">{staff.emergencyContactPhone}</div>
                            </div>
                          ) : "-"}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {staff.dailyWage > 0 ? (
                            <div className="text-xs text-blue-600 font-black">₹{staff.dailyWage.toLocaleString()}/day</div>
                          ) : (
                            <div className="text-xs text-slate-700 font-black">₹{staff.basicSalary.toLocaleString()}/mo</div>
                          )}
                          <div className="text-[10px] text-red-500 font-bold">Adv: ₹{(staff.advanceBalance || 0).toLocaleString()}</div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black tracking-wide ${staff.isActive ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>
                            {staff.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button
                            onClick={() => handleEditStaff(staff)}
                            className="p-1 text-slate-500 hover:text-orange-500 transition mr-2"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 4. ADVANCES LEDGER REGISTER */}
      {activeTab === "advances" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Issue Advance Form */}
          <div className="glass-panel space-y-4">
            <h3 className="font-bold text-slate-800 text-md">Issue Wage Advance</h3>
            <form onSubmit={handleIssueAdvance} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Select Staff Member</label>
                <select
                  required
                  value={advStaffId}
                  onChange={(e) => setAdvStaffId(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="">Choose Employee</option>
                  {usersList.map(u => (
                    <option key={u.id} value={u.id}>{u.name} (Current Bal: ₹{(u.advanceBalance || 0).toLocaleString()})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Advance Amount (₹)</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={advAmount}
                  onChange={(e) => setAdvAmount(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="₹ Amount to disburse"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Disbursement Date</label>
                <input
                  type="date"
                  required
                  value={advDate}
                  onChange={(e) => setAdvDate(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Method</label>
                <select
                  value={advMode}
                  onChange={(e) => setAdvMode(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                >
                  <option value="cash">Cash Register</option>
                  <option value="bank_transfer">HDFC Bank Transfer</option>
                  <option value="upi">UPI / GPay Screenshot</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Disbursement Reason</label>
                <input
                  type="text"
                  value={advReason}
                  onChange={(e) => setAdvReason(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
                  placeholder="Reason for advance..."
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg text-xs uppercase tracking-wider transition"
              >
                Log Advance Payment
              </button>
            </form>
          </div>

          {/* Advances Ledger */}
          <div className="lg:col-span-2 glass-panel space-y-4">
            <h3 className="font-bold text-slate-800 text-md">Advances Ledgers Registry</h3>
            <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
              <table className="w-full text-left text-sm text-slate-700 bg-white">
                <thead className="bg-slate-50 text-slate-600 uppercase font-black tracking-wide border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Employee</th>
                    <th className="px-4 py-3">Mode</th>
                    <th className="px-4 py-3">Reason</th>
                    <th className="px-4 py-3">Salary Deduct Status</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {advancesList.map((adv) => {
                    const staff = usersList.find(u => u.id === adv.userId);
                    return (
                      <tr key={adv.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 text-xs text-slate-400">
                          {new Date(adv.date).toLocaleDateString("en-IN")}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-slate-900">{staff?.name || `ID: ${adv.userId}`}</div>
                          <div className="text-[10px] text-slate-400 uppercase font-bold">{staff?.employeeId}</div>
                        </td>
                        <td className="px-4 py-3 text-xs uppercase text-slate-600 font-semibold">{adv.paymentMode.replace("_", " ")}</td>
                        <td className="px-4 py-3 text-xs text-slate-500">{adv.reason || "-"}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black tracking-wide ${adv.isAdjusted ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                            {adv.isAdjusted ? "Adjusted" : "Outstanding"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-black text-slate-950">{formatCurrency(adv.amount)}</td>
                      </tr>
                    );
                  })}
                  {advancesList.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-slate-400 text-xs">
                        No outstanding salary advances issued.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 5. MONTHLY SALARY PAYABLE SUMMARY */}
      {activeTab === "payroll" && (
        <div className="glass-panel space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h3 className="font-bold text-slate-800 text-lg">Monthly Salaries Registry</h3>
              <p className="text-xs text-slate-500 mt-0.5">Calculate shift wages, reconcile outstanding advances, and disburse payable salaries.</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none"
              >
                {monthNames.map((name, i) => (
                  <option key={i} value={i + 1}>{name}</option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-slate-800 text-xs focus:outline-none"
              >
                {yearList.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
            <table className="w-full text-left text-xs text-slate-700 bg-white">
              <thead className="bg-slate-50 text-slate-600 uppercase font-black tracking-wide border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Attendance Days (P / ½ / A)</th>
                  <th className="px-4 py-3 text-right">Earned Base</th>
                  <th className="px-4 py-3 text-right">Overtime Pay (₹)</th>
                  <th className="px-4 py-3 text-right">Deduct Advances (₹)</th>
                  <th className="px-4 py-3 text-right">Other Deductions (₹)</th>
                  <th className="px-4 py-3 text-right">Net Payable</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {usersList.map((staff) => {
                  const uid = staff.id;
                  const record = payrollList.find(p => p.userId === staff.id && p.month === selectedMonth && p.year === selectedYear);
                  
                  // Compute net salary
                  const isPaid = record?.status === "paid";
                  const displayBasic = proBasicSalary[uid] !== undefined ? Number(proBasicSalary[uid]) : staff.basicSalary;
                  const displayDaily = proDailyWage[uid] !== undefined ? Number(proDailyWage[uid]) : staff.dailyWage;
                  const displayPresent = proPresentDays[uid] !== undefined ? Number(proPresentDays[uid]) : 0;
                  const displayHalf = proHalfDays[uid] !== undefined ? Number(proHalfDays[uid]) : 0;
                  const displayOT = proOvertimePay[uid] !== undefined ? Number(proOvertimePay[uid]) : 0;
                  const displayAdv = proAdvancesPaid[uid] !== undefined ? Number(proAdvancesPaid[uid]) : 0;
                  const displayDeduct = proDeductions[uid] !== undefined ? Number(proDeductions[uid]) : 0;

                  let calculatedEarned = 0;
                  if (displayDaily > 0) {
                    calculatedEarned = (displayDaily * displayPresent) + (displayDaily * 0.5 * displayHalf);
                  } else {
                    calculatedEarned = Math.round(((displayBasic / 30) * displayPresent) + ((displayBasic / 30) * 0.5 * displayHalf));
                  }

                  const calculatedNet = Math.max(0, calculatedEarned + displayOT - displayAdv - displayDeduct);

                  return (
                    <tr key={staff.id} className="hover:bg-slate-50/50">
                      <td className="px-4 py-3">
                        <div className="font-extrabold text-slate-900">{staff.name}</div>
                        <span className="text-[10px] text-slate-400 font-bold uppercase">{staff.employeeId}</span>
                      </td>
                      <td className="px-4 py-3">
                        {record ? (
                          <div className="font-mono font-bold text-slate-700">
                            {record.presentDays} P / {record.halfDays} ½ / {record.absentDays} A
                          </div>
                        ) : (
                          <div className="flex gap-1 items-center">
                            <input
                              type="number"
                              className="w-10 px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-center focus:outline-none"
                              placeholder="P"
                              value={proPresentDays[uid] || ""}
                              onChange={(e) => setProPresentDays({ ...proPresentDays, [uid]: e.target.value })}
                            />
                            <input
                              type="number"
                              className="w-10 px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-center focus:outline-none"
                              placeholder="½"
                              value={proHalfDays[uid] || ""}
                              onChange={(e) => setProHalfDays({ ...proHalfDays, [uid]: e.target.value })}
                            />
                            <input
                              type="number"
                              className="w-10 px-1 py-0.5 bg-slate-50 border border-slate-200 rounded text-center focus:outline-none"
                              placeholder="A"
                              value={proAbsentDays[uid] || ""}
                              onChange={(e) => setProAbsentDays({ ...proAbsentDays, [uid]: e.target.value })}
                            />
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {record ? (
                          <span className="font-semibold text-slate-900">{formatCurrency(record.dailyWage > 0 ? (record.dailyWage * record.presentDays + record.dailyWage * 0.5 * record.halfDays) : Math.round((record.basicSalary / 30) * record.presentDays + (record.basicSalary / 30) * 0.5 * record.halfDays))}</span>
                        ) : (
                          <span className="font-mono text-slate-500 font-semibold">{formatCurrency(calculatedEarned)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {record ? (
                          <span className="font-semibold text-slate-800">{formatCurrency(record.overtimePay)}</span>
                        ) : (
                          <input
                            type="number"
                            className="w-16 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-right focus:outline-none font-mono"
                            value={proOvertimePay[uid] || ""}
                            onChange={(e) => setProOvertimePay({ ...proOvertimePay, [uid]: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {record ? (
                          <span className="font-semibold text-red-600">-{formatCurrency(record.advancesPaid)}</span>
                        ) : (
                          <input
                            type="number"
                            className="w-16 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-right focus:outline-none font-mono text-red-600"
                            value={proAdvancesPaid[uid] || ""}
                            onChange={(e) => setProAdvancesPaid({ ...proAdvancesPaid, [uid]: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {record ? (
                          <span className="font-semibold text-slate-500">-{formatCurrency(record.deductions)}</span>
                        ) : (
                          <input
                            type="number"
                            className="w-16 px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-right focus:outline-none font-mono text-slate-600"
                            value={proDeductions[uid] || ""}
                            onChange={(e) => setProDeductions({ ...proDeductions, [uid]: e.target.value })}
                          />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-black">
                        {record ? (
                          <span className="text-green-700 text-sm font-extrabold">{formatCurrency(record.netSalary)}</span>
                        ) : (
                          <span className="text-slate-900 text-sm font-extrabold">{formatCurrency(calculatedNet)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {record ? (
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-black tracking-wide ${isPaid ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"}`}>
                            {record.status}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Uncompiled</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex justify-center gap-1">
                          {!record ? (
                            <>
                              <button
                                onClick={() => handleCalculatePayroll(staff)}
                                className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold rounded"
                              >
                                Auto-Fill
                              </button>
                              <button
                                onClick={() => handlePostPayroll(staff)}
                                className="px-2 py-1 bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold rounded"
                              >
                                Save Sheet
                              </button>
                            </>
                          ) : (
                            !isPaid && (
                              <button
                                onClick={() => handlePayPayroll(record, staff.name)}
                                className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-[10px] font-bold rounded-lg flex items-center gap-1 shadow-sm"
                              >
                                <Check className="w-3 h-3" />
                                Disburse Wage
                              </button>
                            )
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffPage;
