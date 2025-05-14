
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Navigate } from 'react-router-dom';

import LandingPage from './pages/LandingPage';

import Login from './pages/Login';
import Register from './pages/SignUp';
import Status from './pages/Status';
import Products from './pages/Products';


import JobProgress from './pages/jobs/progress';
import JobStatus from './pages/jobs/status';
import Result from './pages/result/result';

import AdminLayout from './layouts/AdminPage';
import AdminSettings from './pages/admin/settings';
import Gateway from './pages/admin/gateway';

const router = createBrowserRouter([
  {
    path: '/',
    element: <LandingPage />,
  },
  {
    path: '/login',
    element: <Login />,
  },
  // {
  //   path: '/register',
  //   element: <Register />,
  // },
  {
    path: '/status',
    element: <Status />,
  },
  {
    path: '/products',
    element: <Products />,
  },
  {
    path: '/job/:id',
    element: <JobProgress />,
  },
  {
    path: '/job/status',
    element: <JobStatus />,
  },
  {
    path: '/result/:job_id/:dataset_id',
    element: <Result />,
  },
  {
    path: '/admin',
    element: <AdminLayout children={null} />,
    children: [
      {
        path: '',
        element: <Navigate to="settings" />,
      },
      {
        path: 'settings',
        element: <AdminSettings />,
      },
      {
        path: 'gateway',
        element: <Gateway />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" />,
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}