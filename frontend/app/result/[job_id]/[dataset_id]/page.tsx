"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useApi } from "@/app/api";
import { Container, Loader, Text, Title, Alert, Group, Space, Center, Stack, Button, ActionIcon } from "@mantine/core";
import { useParams } from "next/navigation";

import { IconDownload } from "@tabler/icons-react";

export default function ResultsPage() {
    const params = useParams();
    const job_id = Array.isArray(params?.job_id) ? params.job_id[0] : params?.job_id;
    const dataset_id = Array.isArray(params?.dataset_id) ? params.dataset_id[0] : params?.dataset_id;

    const api = useApi();

    const [data, setData] = useState(null);
    const [dataLink, setDataLink] = useState('');

    const [contentType, setContentType] = useState('');

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (job_id && dataset_id) {
            const fetchData = async () => {
                try {
                    const response = await api.get(`/v1/job/${job_id}/${dataset_id}`, { responseType: 'blob' });
                    const blob = new Blob([response.data], { type: response.headers['content-type'] });
                    setDataLink(URL.createObjectURL(blob));
                    setContentType(response.headers['content-type']);
                    setData(response.data);
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
        <>
        <Button component="a" href={`/progress/${job_id}`} variant="outline" color="blue" size="md">
            Back to Results
        </Button>
        <Container
            size="xl"
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: loading ? "center" : "flex-start",
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
                    {/* <Title order={2} style={{ wordWrap: "break-word", wordbreak: 'break-all', textAlign: "center" }}>
                        {job_id}
                    </Title>
                    <Title order={4} style={{ wordWrap: "break-word", textAlign: "center" }}>
                        {dataset_id}
                    </Title> */}
                    {/* <Container size="lg" style={{ textAlign: "center" }}> */}
                        {/* <a href={dataLink} download>
                            <Text c="blue">
                                Download 
                            </Text>
                        </a> */}

                    {contentType == 'image/png' ? (
                        <img 
                            src={dataLink} 
                            alt="Result Image" 
                            style={{ 
                                maxWidth: "100%", 
                                maxHeight: "70vh", 
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
        </>
    );
}