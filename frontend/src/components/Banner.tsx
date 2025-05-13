import React from 'react';
import { Alert, Title, Box} from '@mantine/core';

const Banner: React.FC = () => {
    const [showAlert, setShowAlert] = React.useState(true);

    return (
        showAlert && (
            <Alert p='xs' h='56px' color="red" variant="filled" withCloseButton closeButtonLabel="Dismiss" onClose={() => setShowAlert(false)}>
                <Title c="white" p='' m='' order={6} style={{ fontFamily: 'Nebula-Bold'}}>PROTOTYPE</Title>
                <Box p='' m= ''><strong>This is a prototype providing an experimental service of ECMWF products. </strong></Box>
            </Alert>
        )
    );
};

export default Banner;