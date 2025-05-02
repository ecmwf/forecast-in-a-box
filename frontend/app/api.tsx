import axios from 'axios';
import { useSettings } from '@/app/SettingsContext';

export function useApi() {
  const { settings } = useSettings();

  const api = axios.create({
    baseURL: settings.apiUrl,
  });
  api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  })
  

  return api;
}
