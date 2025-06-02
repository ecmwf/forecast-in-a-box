
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import Intro from '../components/landing/intro';
import DAG from '../components/landing/dag';
import Building from '../components/landing/building_on';
import Collaboration from '../components/landing/collaboration';

import MainLayout from '../layouts/MainLayout';

export default function LandingPage() {  
  return (
    <MainLayout>
      <Intro />
      <DAG />
      <Building />
      <Collaboration />
    </MainLayout>
  );
};

