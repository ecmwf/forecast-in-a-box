

import MainLayout from './MainLayout';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function LoggedIn({ children }: { children: React.ReactNode }) {

    const token = localStorage.getItem('token')
    const navigate = useNavigate();

    useEffect(() => {
        if (!token) {
            navigate('/login');
        }
    }, [token, navigate]);

    return (
        <MainLayout>
            {children}
        </MainLayout>
  );
}
