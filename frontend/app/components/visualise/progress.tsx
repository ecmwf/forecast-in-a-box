import { useEffect, useState } from 'react';
import { Progress, Container, Title, Text, Button} from '@mantine/core';

const ProgressVisualizer = ({ id }: { id: string }) => {
    const [progressResponse, setProgressResponse] = useState<string>();
    const [progress, setProgress] = useState<number | null>(null);

    useEffect(() => {
        const fetchProgress = async () => {
            try {
                const response = await fetch(`/api/py/graph/progress/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({'job_id': id}),
                });
                if (!response.ok) {
                    throw new Error(`HTTP error! Status: ${response.status}`);
                }
                const data = await response.json();
                const sanitisedProgress = parseFloat(data.progress.replace('%', ''));
                setProgress(sanitisedProgress);
                setProgressResponse(response.statusText);
            } catch (error) {
                // console.error('Error fetching progress:', error);
            }
        };

        const interval = setInterval(fetchProgress, 7000); // Fetch progress every 5 seconds
        fetchProgress(); // Initial fetch

        return () => clearInterval(interval); // Cleanup on component unmount
    }, [id]);

    return (
        <Container>
            <Title order={1}>Progress</Title>
            <Title order={4}>{id}</Title>
            {progress === null ? (
                <>
                <Title pb='xl' order={6}>Waiting for Cascade...</Title>
                <Text>{progressResponse}</Text>
                </>
            ) : (
                <>
                <Progress value={progress || 0} striped animated key={progress}/>
                </>
            )}
        </Container>
    );
};

export default ProgressVisualizer;