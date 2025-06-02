
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { createContext, useContext, useState, useEffect } from 'react';
const backendBase = import.meta.env.VITE_API_BASE || '/api'

type Settings = {
  apiUrl: string;
  banner_text: string;
  theme: 'light' | 'dark';
  language: string;
};

const defaultSettings: Settings = {
  apiUrl: backendBase,
  banner_text: 'PROTOTYPE',
  theme: 'light',
  language: 'en',
};

const SettingsContext = createContext<{
  settings: Settings;
  updateSetting: (key: keyof Settings, value: Settings[keyof Settings]) => void;
  updateSettings: (newSettings: Partial<Settings>) => void;
}>({
  settings: defaultSettings,
  updateSetting: () => {},
  updateSettings: () => {},
});

function loadInitialSettings(): Settings {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('app-settings');
    if (stored) {
      try {
        return JSON.parse(stored) as Settings;
      } catch (e) {
        console.error('Failed to parse settings from localStorage', e);
      }
    }
  }
  return defaultSettings;
}

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<Settings>(loadInitialSettings);

  useEffect(() => {
    localStorage.setItem('app-settings', JSON.stringify(settings));
  }, [settings]);

  const updateSetting = (key: keyof Settings, value: Settings[keyof Settings]) => {
    setSettings(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings(prev => ({
      ...prev,
      ...newSettings,
    }));
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, updateSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
