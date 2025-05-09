import React from 'react';
import { Alert, Title } from '@mantine/core';

const Banner: React.FC = () => {
    const title = <Title c="white" order={5} style={{ fontFamily: 'Nebula-Bold'}}>PROTOTYPE</Title>;
    return (
        <Alert title={title} color="red" variant="filled" >
            <strong>This is a prototype providing an experimental service of ECMWF products. </strong>
        </Alert>
    );
};

export default Banner;