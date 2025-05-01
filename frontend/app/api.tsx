"use client";

import axios from 'axios';
import { useSettings } from '@/app/SettingsContext';

export function useApi() {
  const { settings } = useSettings();

  const api = axios.create({
    baseURL: settings.apiUrl,
  });

  return api;
}
