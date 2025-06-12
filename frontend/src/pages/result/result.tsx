
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";
import { useParams } from 'react-router-dom'

import MainLayout from "../../layouts/MainLayout";
import Result from "../../components/results/Result";

export default function ResultsPage() {
    let {job_id, dataset_id} = useParams();
    
    return (
        <MainLayout>
            <Result job_id={job_id} dataset_id={dataset_id} />
        </MainLayout>
    )
}