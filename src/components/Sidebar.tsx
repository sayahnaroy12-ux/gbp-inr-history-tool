import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Map, Package, Users, MapPin, Bell, Settings, ChartNoAxesCombined } from 'lucide-react';
import { useSupplyChain } from '../store/SupplyChainContext';

const navItems = [
  { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
  { name: 'Logistics Map', path: '/map', icon: Map },
  { name: 'Inventory', path: '/inventory', icon: Package },
  { name: 'Suppliers', path: '/suppliers', icon: Users },
  { name: 'Location Manager', path: '/locations', icon: MapPin },
  { name: 'Alerts', path: '/alerts', icon: Bell },
  { name: 'FX History', path: '/exchange-rates', icon: ChartNoAxesCombined },
  { name: 'Settings', path: '/settings', icon: Settings },
];

export default function Sidebar() {
  const { userProfile } = useSupplyChain();
  
  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  };

  return (
    <div className="w-64 bg-slate-900 text-slate-300 flex flex-col h-full border-r border-slate-800">
      <div className="p-6 flex items-center space-x-3 text-white">
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
          <MapPin className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-lg tracking-tight">Control Tower</span>
      </div>
      
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.name}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3 py-2.5 rounded-lg transition-colors ${
                  isActive
                    ? 'bg-blue-600/10 text-blue-400 font-medium'
                    : 'hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span>{item.name}</span>
            </NavLink>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-slate-800">
        {userProfile && (
          <NavLink to="/profile" className="flex items-center space-x-3 hover:bg-slate-800 p-2 rounded-lg transition-colors">
            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-white">
              {getInitials(userProfile.name)}
            </div>
            <div>
              <p className="text-sm font-medium text-white truncate max-w-[140px]">{userProfile.name}</p>
              <p className="text-xs text-slate-500 truncate max-w-[140px]">{userProfile.role}</p>
            </div>
          </NavLink>
        )}
      </div>
    </div>
  );
}
