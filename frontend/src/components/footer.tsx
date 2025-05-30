
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import React from 'react';
import { Container, Text, Group, Anchor, Image } from '@mantine/core';

const Footer: React.FC = () => {
    return (
    <Container
        w='100vw'
        fluid
        style={{
            marginTop: 'auto',
            padding: '1rem 0',
            backgroundColor: '#e8f9fa',
        }}
    >
        <Group align='center' justify='center'>
            <Text size="sm">
                © {new Date().getFullYear()} ECMWF. All rights reserved.
            </Text>

            <Group>    
                <Anchor href="/privacy-policy" size="sm">
                    Privacy Policy
                </Anchor>
                <Anchor href="/terms-of-service" size="sm">
                    Terms of Service
                </Anchor>
                <Anchor href="/status" size="sm">
                    System Status
                </Anchor>
            </Group>
            <Image src="/logos/org/destine.png" w={240} h={20} />
        </Group>
    </Container>
    );
};

export default Footer;