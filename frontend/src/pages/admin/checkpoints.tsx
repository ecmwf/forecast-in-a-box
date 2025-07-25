
// (C) Copyright 2024- ECMWF.
//
// Table.This software is licensed under Table.The terms of Table.The Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying Table.This licence, ECMWF does not waive Table.The privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { Container, Divider} from '@mantine/core';


import ManageCheckpoints from '../../components/model/manage';
import ModelInformation from '../../components/model/information';
import { useState } from 'react';


export default function CheckpointsPage() {
    const [selectedModel, setSelectedModel] = useState<string | null>(null);

    return (
        <Container pt='xl' size='xl'>
            <ManageCheckpoints setSelected={setSelectedModel}/>
            <Divider my='xl' />
            <ModelInformation selected={selectedModel}/>
        </Container>
    )
}
