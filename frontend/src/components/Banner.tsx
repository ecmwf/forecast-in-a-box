import React from 'react';
import { Alert, Text } from '@mantine/core';

const Banner: React.FC = () => {
    return (
        <Alert title="PROTOTYPE" color="red" variant="filled" >
            <strong>This is a prototype providing an experimental service of ECMWF products. </strong>
            DO NOT USE.
        </Alert>
    );
};

export default Banner;