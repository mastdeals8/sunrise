import React from "react";
import { Switch, Route, Redirect, Link, useLocation } from "wouter";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { GlobalDateProvider } from "./contexts/GlobalDateContext";
import { NotificationBell } from "./components/NotificationBell";
import {
  LayoutDashboard,
  LogOut,
  Menu,
  X,
  Database,
  Shield,
  ChevronDown,
} from "lucide-react";

// Lazy pages
import Dashboard from "./pages/Dashboard";
import StaffPage from "./pages/Staff";
import TasksPage from "./pages/Tasks";
import PettyCashPage from "./pages/PettyCash";
import FinancePage from "./pages/Finance";
import OperationsPage from "./pages/Operations";
import AdminPage from "./pages/Admin";
import MaterialCodesPage from "./pages/MaterialCodes";
import SubmittedInvoicesPage from "./pages/SubmittedInvoices";
import PendingPaymentsPage from "./pages/PendingPayments";
import ClientLedgerPage from "./pages/ClientLedger";
import ProjectDocumentsPage from "./pages/ProjectDocuments";
import InvoicePacketPage from "./pages/InvoicePacket";
import SettingsPage from "./pages/Settings";
import MyProfile from "./pages/MyProfile";
import RolesPage from "./pages/Roles";
import Login from "./pages/Login";
import TelegramSettings from "./pages/TelegramSettings";
import WhatsAppSettings from "./pages/WhatsAppSettings";
import TallySettingsPage from "./pages/TallySettings";
import BotInbox from "./pages/BotInbox";
import EstimateTemplates from "./pages/EstimateTemplates";
import CustomerRateCards from "./pages/CustomerRateCards";
import JobsPage from "./pages/Jobs";
import ClientWorkspace from "./pages/ClientWorkspace";
import FieldProjectUpload from "./pages/FieldProjectUpload";
import {
  ClientsRoute,
  BrandsRoute,
  StoresRoute,
  ProductsRoute,
  EstimatesRoute,
  ProjectsRoute,
  DeliveryChallansRoute,
  InvoicesRoute,
  ImportExportRoute,
  ProjectTrackerRoute,
} from "./pages/focused-routes";

interface NavItem {
  href: string;
  label: string;
  match?: (loc: string, hash: string) => boolean;
}

interface NavSection {
  key: string;
  label: string;         // group heading text (shown in uppercase label)
  icon?: React.ComponentType<{ className?: string }>; // only used for collapsible sections
  href?: string;         // if set: single direct link, no subitems
  items?: NavItem[];
  roles?: string[];
  alwaysOpen?: boolean;  // if true: items always visible, no expand button
}

const SECTIONS: NavSection[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    href: "/",
  },
  {
    key: "sales",
    label: "SALES",
    alwaysOpen: true,
    items: [
      { href: "/estimates",          label: "Estimate Register",  match: (l) => l === "/estimates" || l === "/operations" },
      { href: "/projects",           label: "Projects",           match: (l) => l === "/projects" },
      { href: "/invoices",           label: "Invoices",           match: (l) => l === "/invoices" },
      { href: "/estimate-templates", label: "Estimate Templates", match: (l) => l === "/estimate-templates" },
    ],
    roles: ["admin", "manager", "designer", "accounts", "staff"],
  },
  {
    key: "operations",
    label: "OPERATIONS",
    alwaysOpen: true,
    items: [
      { href: "/delivery-challans", label: "WCC Audit Register", match: (l) => l === "/delivery-challans" },
      { href: "/project-documents", label: "Document Archive",   match: (l) => l === "/project-documents" },
    ],
    roles: ["admin", "manager", "production", "designer", "installer", "accounts", "staff"],
  },
  {
    key: "finance",
    label: "FINANCE",
    alwaysOpen: true,
    items: [
      { href: "/client-ledger",      label: "Client Ledger",      match: (l) => l === "/client-ledger" },
      { href: "/pending-payments",   label: "Pending Payments",   match: (l) => l === "/pending-payments" },
      { href: "/petty-cash",         label: "Petty Cash",         match: (l) => l === "/petty-cash" },
      { href: "/finance",            label: "Payment Ledger",     match: (l) => l === "/finance" },
      { href: "/automation/tally",   label: "Tally Export",       match: (l) => l === "/automation/tally" },
      { href: "/submitted-invoices", label: "Submitted Invoices", match: (l) => l === "/submitted-invoices" },
    ],
    roles: ["admin", "manager", "accounts"],
  },
  {
    key: "master-data",
    label: "Master Data",
    icon: Database,
    items: [
      { href: "/clients",             label: "Clients",        match: (l: string) => l === "/clients" },
      { href: "/products",            label: "Products",       match: (l: string) => l === "/products" },
      { href: "/brands",              label: "Brands",         match: (l: string) => l === "/brands" },
      { href: "/stores",              label: "Stores",         match: (l: string) => l === "/stores" },
      { href: "/material-codes",      label: "Material Codes", match: (l: string) => l === "/material-codes" },
      { href: "/customer-rate-cards", label: "Rate Cards",     match: (l: string) => l === "/customer-rate-cards" },
    ],
    roles: ["admin", "manager"],
  },
  {
    key: "system",
    label: "System",
    icon: Shield,
    items: [
      { href: "/staff",               label: "Staff",            match: (l) => l === "/staff" },
      { href: "/tasks",               label: "Tasks",            match: (l) => l === "/tasks" },
      { href: "/automation/telegram", label: "Telegram Bot",     match: (l) => l === "/automation/telegram" },
      { href: "/automation/whatsapp", label: "WhatsApp API",     match: (l) => l === "/automation/whatsapp" },
      { href: "/automation/inbox",    label: "Bot Inbox",        match: (l) => l === "/automation/inbox" },
      { href: "/admin",               label: "Users",            match: (l) => l === "/admin" },
      { href: "/admin/roles",         label: "Roles",            match: (l) => l === "/admin/roles" },
      { href: "/admin/settings",      label: "Settings",         match: (l) => l === "/admin/settings" },
    ],
    roles: ["admin", "manager"],
  },
];

const useHash = () => {
  const [hash, setHash] = React.useState<string>(typeof window !== "undefined" ? window.location.hash : "");
  React.useEffect(() => {
    const onHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return hash;
};

// Shared NavItem link — used by both always-open and collapsible sections.
const NavLink: React.FC<{ item: NavItem; location: string; hash: string; closeMobile: () => void }> = ({
  item, location, hash, closeMobile,
}) => {
  const active = item.match ? item.match(location, hash) : location === item.href;
  return (
    <Link
      href={item.href}
      onClick={closeMobile}
      className={`relative flex items-center gap-2 px-3 py-1.5 rounded-md text-[12.5px] transition-all duration-150 ${
        active
          ? "text-orange-700 font-bold bg-orange-50"
          : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/70"
      }`}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-r-full bg-orange-500" />}
      <span className={`w-1 h-1 rounded-full shrink-0 ml-0.5 ${active ? "bg-orange-500" : "bg-slate-300"}`} />
      {item.label}
    </Link>
  );
};

const SidebarSection: React.FC<{
  section: NavSection;
  location: string;
  hash: string;
  closeMobile: () => void;
}> = ({ section, location, hash, closeMobile }) => {
  const Icon = section.icon;

  // Direct link (Dashboard)
  if (section.href && !section.items) {
    const active = location === section.href;
    return (
      <Link
        href={section.href}
        onClick={closeMobile}
        className={`relative flex items-center gap-2.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-all duration-150 group ${
          active
            ? "bg-orange-50 text-orange-700 font-semibold"
            : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
        }`}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-orange-500" />}
        {Icon && <Icon className={`w-4 h-4 shrink-0 ${active ? "text-orange-600" : "text-slate-400 group-hover:text-slate-500"}`} />}
        {section.label}
      </Link>
    );
  }

  const items = section.items || [];
  const anyActive = items.some((it) => (it.match ? it.match(location, hash) : location === it.href));

  // Always-open: render items directly, no expand button
  if (section.alwaysOpen) {
    return (
      <div>
        {items.map((it) => (
          <NavLink key={it.href} item={it} location={location} hash={hash} closeMobile={closeMobile} />
        ))}
      </div>
    );
  }

  // Collapsible (Master Data, System)
  const [open, setOpen] = React.useState(anyActive);
  React.useEffect(() => {
    if (anyActive) setOpen(true);
  }, [anyActive]);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold transition-all duration-150 group ${
          anyActive ? "text-slate-900" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100/70"
        }`}
      >
        <span className="flex items-center gap-2">
          {Icon && <Icon className={`w-3.5 h-3.5 shrink-0 ${anyActive ? "text-orange-600" : "text-slate-400 group-hover:text-slate-500"}`} />}
          {section.label}
        </span>
        <ChevronDown className={`w-3 h-3 text-slate-300 transition-transform duration-200 ${open ? "rotate-0" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="mt-0.5 space-y-0">
          {items.map((it) => (
            <NavLink key={it.href} item={it} location={location} hash={hash} closeMobile={closeMobile} />
          ))}
        </div>
      )}
    </div>
  );
};

const AppContent: React.FC = () => {
  const { user, token, loading, logout } = useAuth();
  const [location] = useLocation();
  const hash = useHash();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent"></div>
          <p className="text-sm font-medium text-slate-500">Loading Sunrise Media ERP...</p>
        </div>
      </div>
    );
  }

  if (location.startsWith("/field/")) {
    return <FieldProjectUpload />;
  }

  if (!token || !user) {
    if (location === "/login") {
      return <Login />;
    }
    return <Redirect to="/login" />;
  }

  if (location === "/login") {
    return <Redirect to="/" />;
  }

  const role = (user.role || "").toLowerCase();
  const sections = SECTIONS.filter((s) => !s.roles || s.roles.includes(role) || role === "admin");

  return (
    <div className="app-shell flex h-screen w-screen bg-slate-50 text-slate-800 overflow-hidden font-sans">
      {/* Mobile Top Bar */}
      <div className="app-mobile-topbar lg:hidden flex justify-between items-center bg-white border-b border-slate-100 px-4 py-3 fixed top-0 w-full z-40">
        <img src="/brand/logo.png" alt="Sunrise Media" className="h-7 w-auto" />
        <div className="flex items-center gap-3">
          <NotificationBell />
          <button onClick={() => setSidebarOpen(!sidebarOpen)} className="text-slate-500 hover:text-slate-900 transition">
            {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Sidebar */}
      <aside
        className={`app-sidebar fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-white border-r border-slate-100 transition-transform duration-300 lg:translate-x-0 lg:static lg:h-full lg:z-auto ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <Link href="/" onClick={() => setSidebarOpen(false)}>
            <img src="/brand/logo.png" alt="Sunrise Media" className="h-7 w-auto cursor-pointer" />
          </Link>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              onClick={() => setSidebarOpen(false)}
              className="lg:hidden text-slate-400 hover:text-slate-700 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-2 overflow-y-auto">
          {sections.map((s, idx) => (
            <React.Fragment key={s.key}>
              {/* Group label: always-open sections show their label as a heading;
                  collapsible sections show the label inside the button instead */}
              {s.alwaysOpen && (
                <div className={`px-3 pb-1 ${idx === 0 ? "pt-2" : "pt-4"}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{s.label}</span>
                </div>
              )}
              {/* Dashboard gets a small gap before collapsible sections below it */}
              {!s.alwaysOpen && !s.href && idx > 0 && (
                <div className="pt-3 pb-0.5" />
              )}
              <SidebarSection
                section={s}
                location={location}
                hash={hash}
                closeMobile={() => setSidebarOpen(false)}
              />
            </React.Fragment>
          ))}
        </nav>

        {/* Footer — user info + logout */}
        <div className="border-t border-slate-100 p-2 space-y-0.5">
          <Link
            href="/profile"
            onClick={() => setSidebarOpen(false)}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-slate-100/70 transition"
          >
            <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-orange-500 to-amber-400 flex items-center justify-center font-bold text-white text-xs uppercase shrink-0">
              {user.name.slice(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-slate-800 truncate leading-tight">{user.name}</p>
              <p className="text-[11px] text-orange-600 font-medium capitalize">{user.role}</p>
            </div>
          </Link>
          <button
            onClick={logout}
            className="flex items-center gap-2.5 w-full px-3 py-2 rounded-lg text-[13px] font-medium text-slate-500 hover:text-red-600 hover:bg-red-50 transition"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="app-main flex-1 flex flex-col min-w-0 overflow-hidden lg:pt-0 pt-12 relative bg-slate-50">
        <div className="app-main-scroll flex-1 overflow-y-auto p-4 lg:p-6">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/staff" component={StaffPage} />
            <Route path="/tasks" component={TasksPage} />
            <Route path="/petty-cash" component={PettyCashPage} />
            <Route path="/finance" component={FinancePage} />

            {/* Bolt-style dedicated pages (focused OperationsPage panels) */}
            <Route path="/clients" component={ClientsRoute} />
            <Route path="/clients/:id" component={ClientWorkspace} />
            <Route path="/brands" component={BrandsRoute} />
            <Route path="/stores" component={StoresRoute} />
            <Route path="/products" component={ProductsRoute} />
            <Route path="/estimates" component={EstimatesRoute} />
            <Route path="/projects" component={ProjectsRoute} />
            <Route path="/delivery-challans" component={DeliveryChallansRoute} />
            <Route path="/invoices" component={InvoicesRoute} />
            <Route path="/import-export" component={ImportExportRoute} />
            <Route path="/project-tracker" component={ProjectTrackerRoute} />

            {/* Legacy Operations hub kept for any deep links; sidebar no longer
                points to it but old URLs still resolve. */}
            <Route path="/operations">{() => <OperationsPage />}</Route>

            <Route path="/profile" component={MyProfile} />
            <Route path="/admin" component={AdminPage} />
            <Route path="/admin/roles" component={RolesPage} />
            <Route path="/admin/settings" component={SettingsPage} />
            <Route path="/material-codes" component={MaterialCodesPage} />
            <Route path="/submitted-invoices" component={SubmittedInvoicesPage} />
            <Route path="/pending-payments" component={PendingPaymentsPage} />
            <Route path="/client-ledger" component={ClientLedgerPage} />
            <Route path="/project-documents" component={ProjectDocumentsPage} />
            <Route path="/invoice-packet" component={InvoicePacketPage} />
            <Route path="/automation/telegram" component={TelegramSettings} />
            <Route path="/automation/whatsapp" component={WhatsAppSettings} />
            <Route path="/automation/tally" component={TallySettingsPage} />
            <Route path="/automation/inbox" component={BotInbox} />
            <Route path="/estimate-templates" component={EstimateTemplates} />
            <Route path="/customer-rate-cards" component={CustomerRateCards} />
            <Route path="/jobs" component={JobsPage} />
            <Route>
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <h1 className="text-3xl font-bold mb-2">404 - Not Found</h1>
                <p>The page you are looking for doesn't exist.</p>
                <Link
                  href="/"
                  className="mt-4 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition"
                >
                  Go to Dashboard
                </Link>
              </div>
            </Route>
          </Switch>
        </div>
      </main>
    </div>
  );
};

const App: React.FC = () => {
  return (
    <AuthProvider>
      <GlobalDateProvider>
        <AppContent />
      </GlobalDateProvider>
    </AuthProvider>
  );
};

export default App;
