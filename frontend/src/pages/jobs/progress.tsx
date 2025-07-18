
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import LoggedIn from '../../layouts/LoggedIn';
import ProgressComponent from '../../components/jobs/progress';
import { useParams } from 'react-router-dom';
import { Container } from '@mantine/core';

const ProgressPage = () => {
    let {id} = useParams();
    return (
        <LoggedIn>
            <Container size='lg' pt='xl'>
                <ProgressComponent id={id} popout={false} />
            </Container>
        </LoggedIn>
    );
}

export default ProgressPage;