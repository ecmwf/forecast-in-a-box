
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

export default function LoggedIn({ children }: { children: React.ReactNode }) {

    const fiabtoken = localStorage.getItem('fiabtoken')
    const navigate = useNavigate();

    useEffect(() => {
        if (!fiabtoken) {
            navigate(`/login?q=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        }
    }, [fiabtoken, navigate]);

    return (
        <MainLayout>
            {children}
        </MainLayout>
  );
}
