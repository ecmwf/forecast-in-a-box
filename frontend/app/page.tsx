"use client";

import React from 'react';

import Intro from './components/intro';
import DAG from './components/dag';
import Building from './components/building_on';

import './page.module.css';

const HomePage = () => {
  return (
    <>
      <Intro />
      <DAG />
      <Building />
    </>
  );
};

export default HomePage;