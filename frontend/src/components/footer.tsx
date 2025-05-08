import React from 'react';
import { Container, Text, Group, Anchor, Button } from '@mantine/core';

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
        </Group>
    </Container>
    );
};

export default Footer;