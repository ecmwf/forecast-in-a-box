
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useEffect, useState } from "react";
import { useApi } from "../../api";
import { Container, Loader, Text, Title, Alert, Space, Center, Stack, Button, ActionIcon, Group } from "@mantine/core";

import ImageShare from "./image_share";
import InteractiveMap from "./interactive";

import { IconDownload } from "@tabler/icons-react";

interface ResultProps {
    job_id: string;
    dataset_id: string;
    in_modal?: boolean;
}

export default function Result({ job_id, dataset_id, in_modal }: ResultProps) {
    const api = useApi();

    const [dataLink, setDataLink] = useState('');
    const [contentType, setContentType] = useState('');

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (job_id && dataset_id) {
            const fetchData = async () => {
                try {
                    const response = await api.get(`/v1/job/${job_id}/${dataset_id}`, { responseType: 'blob' });
                    setContentType(response.headers['content-type']);

                    let contentType = response.headers['content-type'] || 'application/octet-stream';
                    contentType = contentType.replace(/\/i/, '/');
                    const blob = new Blob([response.data], { type: contentType });
                    setDataLink(URL.createObjectURL(blob));
                    console.log("Content-Type:", contentType);
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
        <Group justify='space-between' w='90%' mb='xl'>
            {!in_modal ? (
                <Button component="a" href={`/job/${job_id}`} variant="outline" color="blue" size="md" m='xl'>
                    Back to Results
                </Button>
            ) : (
                <Title order={2} style={{ wordWrap: "break-word", textAlign: "center" }}>
                    <Text>Result for {dataset_id}</Text>
                </Title>
            )}
            {contentType.startsWith('image') ? (
                <ImageShare
                    imageUrl={`${window.location.origin}/share/${job_id}/${dataset_id}`}
                    title={`Forecast in a Box - ${dataset_id}`}
                />
            ) : null}
        </Group>

        <Container
            size="xl"
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: loading ? "center" : "flex-start",
                minHeight: "40vh",
                minWidth: "70vw",
            }}
        >

            <Center w='90%' h='100%'>
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
                <>
                    {contentType.startsWith('image/i') ? (
                        <InteractiveMap globeImageUrl={dataLink} />
                    ) : contentType.startsWith('image') ? (
                        <>
                            <img
                                src={dataLink}
                                alt="Result Image"
                                style={{
                                    maxWidth: "90%",
                                    maxHeight: "80%",
                                    borderRadius: "8px",
                                    boxShadow: "0 4px 8px rgba(0, 0, 0, 0.1)"
                                }}
                            />
                        </>
                    ) : (
                        <Stack align="center" style={{ flex: 1 }}>
                        <ActionIcon
                            component="a"
                            href={dataLink}
                            download={`${dataset_id}.${contentType.split('/')[1]}`}
                            size="xxl"
                        >
                            <IconDownload size={'30vh'} />
                        </ActionIcon>
                        <Title order={3} style={{ wordWrap: "break-word", textAlign: "center" }}>
                            Download
                        </Title>
                        </Stack>
                    )}
                </>
            )}
        </Center>
        </Container>
        </>
    );
}
