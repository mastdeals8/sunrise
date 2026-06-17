import React, { useEffect, useState } from "react";
import { isBoltMode } from "../lib/supabase";
import { fetchTasks, fetchUsers } from "../lib/api";
import { useAuth } from "../contexts/AuthContext";
import { 
  Plus, 
  Calendar, 
  User, 
  Tag, 
  Trash, 
  CheckSquare, 
  Play, 
  Check, 
  AlertCircle 
} from "lucide-react";

interface Task {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  dueDate: string | null;
  assignedTo: number | null;
  assignedBy: number;
}

interface Staff {
  id: number;
  name: string;
}

const TasksPage: React.FC = () => {
  const { token, user: currentUser } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);

  // Task creation states
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDate, setDueDate] = useState("");
  const [assignedTo, setAssignedTo] = useState<number | undefined>(undefined);
  const [message, setMessage] = useState("");

  const fetchData = async () => {
    try {
      setLoading(true);
      if (isBoltMode) {
        const [t, s] = await Promise.all([
          fetchTasks(token),
          fetchUsers(token),
        ]);
        setTasks(t as any[]);
        setStaffList(s as any[]);
        return;
      }
      const resT = await fetch("/api/tasks", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resT.ok) setTasks(await resT.json());

      const resS = await fetch("/api/users", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resS.ok) setStaffList(await resS.json());
    } catch (err) {
      console.error("Error loading task data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title) return;

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          title,
          description,
          priority,
          dueDate: dueDate || null,
          assignedTo: assignedTo || null,
          status: "pending"
        })
      });

      if (res.ok) {
        setMessage("Task successfully created!");
        setTitle("");
        setDescription("");
        setPriority("medium");
        setDueDate("");
        setAssignedTo(undefined);
        setShowForm(false);
        fetchData();
      }
    } catch (err) {
      console.error("Error creating task:", err);
    }
  };

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ status: newStatus })
      });

      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Error updating task status:", err);
    }
  };

  const handleDeleteTask = async (id: number) => {
    if (!window.confirm("Are you sure you want to delete this task?")) return;
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (res.ok) {
        fetchData();
      }
    } catch (err) {
      console.error("Error deleting task:", err);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  const columns = [
    { id: "pending", label: "Pending", color: "border-t-orange-500" },
    { id: "in_progress", label: "In Progress", color: "border-t-amber-500" },
    { id: "completed", label: "Completed", color: "border-t-green-500" },
    { id: "cancelled", label: "Cancelled", color: "border-t-slate-400" }
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">Production Kanban Board</h1>
          <p className="text-slate-500 text-sm mt-1">Assign, deploy, and organize media production schedules.</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 text-white text-xs font-bold rounded-lg transition-all shadow-md"
        >
          <Plus className="w-4 h-4" />
          Create Production Task
        </button>
      </div>

      {message && (
        <div className="p-3 bg-orange-50 border border-orange-200 text-orange-800 text-xs rounded-lg font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-orange-600" />
          {message}
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreateTask} className="glass-panel p-6 max-w-2xl mx-auto space-y-4">
          <h3 className="font-bold text-slate-900 text-lg">New Production Assignment</h3>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Task Title</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500"
              placeholder="e.g. Edit Product Launch Video"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Details & Description</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none focus:border-orange-500 resize-none"
              placeholder="Provide assignment objectives, assets specs..."
            ></textarea>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Priority Level</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
                <option value="critical">Critical Deadline</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Due Deadline</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Assigned Talent</label>
              <select
                value={assignedTo || ""}
                onChange={(e) => setAssignedTo(e.target.value ? Number(e.target.value) : undefined)}
                className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-800 text-sm focus:outline-none"
              >
                <option value="">Choose Staff...</option>
                {staffList.map((staff) => (
                  <option key={staff.id} value={staff.id}>{staff.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="py-2 px-4 bg-slate-100 hover:bg-slate-200 border border-transparent rounded-lg text-slate-700 text-xs font-bold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="py-2 px-6 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition-all shadow-md"
            >
              Deploy Task
            </button>
          </div>
        </form>
      )}

      {/* Kanban columns grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map((col) => {
          const colTasks = tasks.filter(t => t.status === col.id);
          return (
            <div key={col.id} className={`glass-panel border-t-4 ${col.color} p-4 flex flex-col h-[70vh] bg-slate-50/50`}>
              <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200">
                <span className="font-bold text-sm text-slate-800 tracking-wide">{col.label}</span>
                <span className="text-xs bg-slate-200 px-2 py-0.5 rounded font-black text-slate-700">{colTasks.length}</span>
              </div>

              {/* Tasks list */}
              <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                {colTasks.map((task) => {
                  const assignee = staffList.find(s => s.id === task.assignedTo);
                  return (
                    <div key={task.id} className="p-4 rounded-xl bg-white border border-slate-200 hover:border-orange-500/30 transition-all space-y-3 group shadow-sm">
                      <div>
                        <h4 className="font-bold text-sm text-slate-900 leading-tight break-words">{task.title}</h4>
                        {task.description && (
                          <p className="text-xs text-slate-500 mt-1 break-words leading-relaxed line-clamp-3">{task.description}</p>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-1.5 items-center">
                        {/* Priority Badge */}
                        <span className={`text-[9px] uppercase font-extrabold px-1.5 py-0.5 rounded border ${task.priority === "critical" ? "bg-red-50 text-red-700 border-red-100" : task.priority === "high" ? "bg-orange-50 text-orange-700 border-orange-100" : "bg-slate-100 text-slate-600 border-slate-200"}`}>
                          {task.priority}
                        </span>
                        
                        {/* Due Date */}
                        {task.dueDate && (
                          <span className="text-[10px] text-slate-500 inline-flex items-center gap-1">
                            <Calendar className="w-3 h-3 text-orange-600" />
                            {new Date(task.dueDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          </span>
                        )}
                      </div>

                      {/* Staff Assignment */}
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <span className="text-[10px] text-slate-500 font-semibold inline-flex items-center gap-1.5 truncate max-w-[120px]">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          {assignee ? assignee.name : "Unassigned"}
                        </span>

                        <div className="flex items-center gap-1 opacity-85 group-hover:opacity-100 transition">
                          {col.id === "pending" && (
                            <button
                              onClick={() => handleUpdateStatus(task.id, "in_progress")}
                              title="Start Task"
                              className="p-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-100 transition"
                            >
                              <Play className="w-3 h-3" />
                            </button>
                          )}
                          {col.id === "in_progress" && (
                            <button
                              onClick={() => handleUpdateStatus(task.id, "completed")}
                              title="Complete Task"
                              className="p-1 rounded bg-green-50 hover:bg-green-100 text-green-700 border border-green-100 transition"
                            >
                              <Check className="w-3 h-3" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            title="Delete Task"
                            className="p-1 rounded bg-red-50 hover:bg-red-100 text-red-700 border border-red-100 transition"
                          >
                            <Trash className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {colTasks.length === 0 && (
                  <div className="text-center py-12 text-slate-400 text-xs border border-dashed border-slate-200 rounded-xl">
                    No active tasks
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TasksPage;
