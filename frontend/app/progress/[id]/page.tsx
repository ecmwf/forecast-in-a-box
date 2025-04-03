"use client";

import React from 'react';
import { useParams } from 'next/navigation';
import { Container } from '@mantine/core';

const ProgressPage = () => {
    const params = useParams();
    const id = params?.id;

    return (
        <Container size="xl">
            <h1>Progress Page</h1>
            {id ? (
                <p>Viewing progress for ID: {id}</p>
            ) : (
                <p>Loading...</p>
            )}
        </Container>
    );
};

export default ProgressPage;