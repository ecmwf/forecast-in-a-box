
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.



import MainLayout from './MainLayout';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApi } from '../api';
import { showNotification } from '@mantine/notifications';

export default function LoggedIn({ children }: { children: React.ReactNode }) {

    const navigate = useNavigate();
    
    const api = useApi();

    useEffect(() => {
        api.get('/v1/users/me')
        .then((res) => {
            if (res.status === 200) {
                // User is logged in
            } else {
                navigate(`/login?q=${encodeURIComponent(window.location.pathname + window.location.search)}`);
            }
        })
        .catch(() => {
            showNotification({
                id: 'login-error',
                title: 'Error',
                message: 'Failed to fetch user data',
                color: 'red',
                autoClose: 3000,
                loading: false,
            });
            navigate(`/login?q=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        });
    }, [api, navigate]);

    return (
        <MainLayout>
            {children}
        </MainLayout>
  );
}
