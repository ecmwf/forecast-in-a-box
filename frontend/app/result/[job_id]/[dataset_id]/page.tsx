"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { useApi } from "@/app/api";
import { Container, Loader, Text, Title, Alert, Group } from "@mantine/core";
import { useParams } from "next/navigation";

export default function ResultsPage() {
    const params = useParams();
    const job_id = Array.isArray(params?.job_id) ? params.job_id[0] : params?.job_id;
    const dataset_id = Array.isArray(params?.dataset_id) ? params.dataset_id[0] : params?.dataset_id;

    const api = useApi();

    const [data, setData] = useState(null);
    const [dataLink, setDataLink] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (job_id && dataset_id) {
            const fetchData = async () => {
                try {
                    const response = await api.get(`/api/v1/job/${job_id}/${dataset_id}`);
                    const blob = new Blob([JSON.stringify(response.data, null, 2)]);
                    setDataLink(URL.createObjectURL(blob));
                    setData(response.data);
                } catch (err) {
                    setError(err.response?.data?.detail || err.message || "An error occurred while fetching data.");
                } finally {
                    setLoading(false);
                }
            };

            fetchData();
        }
    }, [job_id, dataset_id, api]);

    return (
        <Container
            size="xl"
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: loading ? "center" : "flex-start",
                height: "100vh",
            }}
        >
            {loading ? (
                <>
                    <Loader size="xl" />
                    <Text>Loading result...</Text>
                </>
            ) : error ? (
                <Alert title="Error" color="red">
                    {error}
                </Alert>
            ) : (
                <>
                    <Group>
                        <Title order={2}>Results for Job: {job_id}</Title>
                        <Title order={4}>Dataset: {dataset_id}</Title>
                    </Group>
                    {data?.image_data ? (
                        <img
                            src={`data:image/png;base64,${data.image_data}`}
                            alt="Result Image"
                            style={{
                                maxWidth: "100%",
                                maxHeight: "80vh",
                                objectFit: "contain",
                                border: "1px solid #ccc",
                                borderRadius: "8px",
                            }}
                        />
                    ) : (
                        <iframe src={dataLink} width="100%" height="80vh" style={{ border: "1px solid #ccc", borderRadius: "8px" }} />
                    )}
                </>
            )}
        </Container>
    );
}