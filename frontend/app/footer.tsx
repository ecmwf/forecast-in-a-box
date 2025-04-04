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
            {/* <nav>
                <ul>
                <li><Button href="/home">Home</Button></li>
                <li><Button href="/models">Models</Button></li>
                <li><Button href="/results">Results</Button></li>
                </ul>
            </nav> */}

            <Group>
                <Anchor href="/privacy-policy" size="sm">
                    Privacy Policy
                </Anchor>
                <Anchor href="/terms-of-service" size="sm">
                    Terms of Service
                </Anchor>
            </Group>
        </Group>
    </Container>
    );
};

export default Footer;