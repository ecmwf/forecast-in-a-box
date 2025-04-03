import { useEffect, useState } from 'react';
import { Progress, Container, Title, Text, ScrollArea, Divider, Flex, ActionIcon} from '@mantine/core';

import { SubmitResponse, DatasetId } from './../interface';


import {IconSearch} from '@tabler/icons-react';

const ProgressVisualizer = ({ job }: { job: SubmitResponse }) => {
    const [progressResponse, setProgressResponse] = useState<string>();
    const [progress, setProgress] = useState<number | null>(null);

    useEffect(() => {
        const fetchProgress = async () => {
            try {
                const response = await fetch(`/api/py/execution/progress/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({'job_id': job.job_id}),
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
    }, [job]);

    return (
        <Container>
            <Title order={1}>Progress</Title>
            <Title order={4}>{job.job_id}</Title>
            {progress === null ? (
                <>
                <Title pb='xl' order={6}>Waiting for Cascade...</Title>
                <Text>{progressResponse}</Text>
                </>
            ) : (
                <>
                <Progress value={progress || 0} striped animated key={progress}/>
                <Text>{progress}%</Text>

                <Divider my='lg' />

                <Title order={4}>Output IDs</Title>
                <ScrollArea h='50vh' type="always">
                <Container bg='000000'>
                {job.output_ids.map((id: DatasetId, index: number) => (
                    <Flex gap='md' justify='space-between'>
                    <Text>{id.task}</Text>
                    <ActionIcon mb='xs' size='lg' mr='21px' disabled={progress != 100} onClick={() => console.log(`Clicked on task: ${id.task}`)}><IconSearch scale='30%'/></ActionIcon>
                    </Flex>
                ))}
                </Container>
                </ScrollArea>
                </>
            )}
        </Container>
    );
};

export default ProgressVisualizer;