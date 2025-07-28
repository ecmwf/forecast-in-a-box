
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import React from 'react';
import { Alert, Title} from '@mantine/core';

import { useSettings } from '../SettingsContext';

const Banner: React.FC = () => {
    const { settings } = useSettings();

    return (
        // <div style={{
        //     position: 'fixed',
        //     bottom: 50,
        //     left: 8,
        //     zIndex: 9999,
        //     maxWidth: '300px'
        // }}>
            <Alert
                p='xs'
                color="red"
                variant="filled"
                // withCloseButton
                closeButtonLabel="Dismiss"
                // w='100px'
            >
                <Title c="white" p='' m='' order={3} style={{ fontFamily: 'Nebula-Bold' }}>
                    {settings.banner_text|| 'PROTOTYPE'}
                </Title>
                {/* <Box p='' m=''><strong>This is a prototype providing an experimental service of ECMWF products. </strong></Box> */}
            </Alert>
        // </div>
        )
    };

export default Banner;
