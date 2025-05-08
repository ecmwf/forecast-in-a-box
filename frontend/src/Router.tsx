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
    path: '*',
    element: <Navigate to="/" />,
  },
]);

export function Router() {
  return <RouterProvider router={router} />;
}