"use client";

import { useEffect, useState } from "react";
import { useApi } from "../../api";
import { Container, Loader, Text, Title, Alert, Space, Center, Stack, Button, ActionIcon } from "@mantine/core";
import { useParams } from 'react-router-dom'

import MainLayout from "../../layouts/MainLayout";

import { IconDownload } from "@tabler/icons-react";

export default function ResultsPage() {
    let {job_id, dataset_id} = useParams();
    const api = useApi();

    const [dataLink, setDataLink] = useState('');
    const [contentType, setContentType] = useState('');

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        console.log(job_id, dataset_id)
        if (job_id && dataset_id) {
            const fetchData = async () => {
                try {
                    const response = await api.get(`/v1/job/${job_id}/${dataset_id}`, { responseType: 'blob' });
                    const blob = new Blob([response.data], { type: response.headers['content-type'] });
                    console.log(response.headers['content-type'])
                    setDataLink(URL.createObjectURL(blob));
                    setContentType(response.headers['content-type']);
                } catch (err) {
                    setError(err.response?.data?.detail || err.message || "An error occurred while fetching data.");
                } finally {
                    setLoading(false);
                }
            };
            fetchData();
        }
    }, [job_id, dataset_id]);

    return (
        <MainLayout>
        <Button component="a" href={`/progress/${job_id}`} variant="outline" color="blue" size="md" m='xl'>
            Back to Results
        </Button>
        <Container
            size="xl"
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: loading ? "center" : "flex-start",
                minHeight: "40vh",
            }}
        >
            <Center w='100%'>
            {loading ? (
                <Stack align="center">
                    <Loader size="xl" />
                    <Text>Loading result...</Text>
                </Stack>
            ) : error ? (
                <Alert title="Error" color="red">
                    {error}
                </Alert>
            ) : (
                <Stack align="center">
                    <Space h={20} />
                    {contentType == 'image/png' ? (
                        <img 
                            src={dataLink} 
                            alt="Result Image" 
                            style={{ 
                                maxWidth: "90vw", 
                                maxHeight: "80vh", 
                                borderRadius: "8px", 
                                boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)" 
                            }} 
                        />
                    ) : (
                        <Stack align="center" style={{ flex: 1 }}>
                        <ActionIcon
                            component="a"
                            href={dataLink}
                            download={`${dataset_id}.pickle`}
                            size="xxl"
                        >
                            <IconDownload size={'30vh'} />
                        </ActionIcon>
                        <Title order={3} style={{ wordWrap: "break-word", textAlign: "center" }}>
                            Download
                        </Title>
                        </Stack>
                    )}
                </Stack>
            )}
        </Center>
        </Container>
        </MainLayout>
    );
}