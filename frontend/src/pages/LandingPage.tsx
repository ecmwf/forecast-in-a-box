"use client";

import Intro from '../components/intro';
import DAG from '../components/dag';
import Building from '../components/building_on';

import MainLayout from '../layouts/MainLayout';

export default function LandingPage() {  
  return (
    <MainLayout>
      <Intro />
      <DAG />
      <Building />
    </MainLayout>
  );
};

