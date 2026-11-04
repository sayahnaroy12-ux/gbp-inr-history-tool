/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SupplyChainProvider, useSupplyChain } from './store/SupplyChainContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import MapPage from './pages/MapPage';
import LocationManager from './pages/LocationManager';
import Inventory from './pages/Inventory';
import Suppliers from './pages/Suppliers';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import Profile from './pages/Profile';
import ExchangeRates from './pages/ExchangeRates';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useSupplyChain();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
};

export default function App() {
  return (
    <SupplyChainProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/gbp-inr" element={<ExchangeRates />} />
          <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="map" element={<MapPage />} />
            <Route path="locations" element={<LocationManager />} />
            <Route path="inventory" element={<Inventory />} />
            <Route path="suppliers" element={<Suppliers />} />
            <Route path="alerts" element={<Alerts />} />
            <Route path="exchange-rates" element={<ExchangeRates />} />
            <Route path="settings" element={<Settings />} />
            <Route path="profile" element={<Profile />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </SupplyChainProvider>
  );
}
