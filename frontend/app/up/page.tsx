"use client";

import { useEffect, useState } from "react";
import { Container, Title, Text, Loader, Table, Paper, Button, Group } from "@mantine/core";

import {useApi} from '@/app/api';


const StatusPage = () => {
    const [status, setStatus] = useState<{
        api: "loading" | "up" | "down";
        cascade: "loading" | "up" | "down";
        ecmwf: "loading" | "up" | "down";
    }>({ api: "loading", cascade: "loading", ecmwf: "loading" });

    const api = useApi();
    
    const checkStatus = async () => {
        setStatus({ api: "loading", cascade: "loading", ecmwf: "loading" });
        try {
            const response = await api.get("/api/v1/status");
            if (response.status == 200) {
                const data = await response.data;
                setStatus({
                    api: data.api || "down",
                    cascade: data.cascade || "down",
                    ecmwf: data.ecmwf || "down",
                });
            } else {
                setStatus({ api: "down", cascade: "down", ecmwf: "down" });
            }
        } catch (error) {
            setStatus({ api: "down", cascade: "down", ecmwf: "down" });
        }
    };

    useEffect(() => {
        checkStatus();
        const interval = setInterval(() => {
            checkStatus();
        }, 10000);

        return () => clearInterval(interval);
    }, []);

    return (
        <Container size="sm" style={{ marginTop: "40px" }}>
            <Paper shadow="xs" p="md" withBorder>
                <Group grow mb="md">
                    <Title order={2} ta="center">
                        Server Status
                    </Title>
                    <Button onClick={checkStatus} variant="outline" size="sm">
                        Refresh
                    </Button>
                </Group>
                <Table striped highlightOnHover verticalSpacing="xs">
                    <Table.Thead>
                        <Table.Tr style={{ backgroundColor: "#f0f0f6", textAlign: "left" }}>
                            <Table.Th>Service</Table.Th>
                            <Table.Th>Status</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {status.api === "loading" ? (
                            <Table.Tr>
                                <Table.Td colSpan={2} style={{ textAlign: "center"}}>
                                    <Loader size="sm" />
                                    <Text ml="sm">Checking server status...</Text>
                                </Table.Td>
                            </Table.Tr>
                        ) : (
                            <>
                                <Table.Tr>
                                    <Table.Td>API Server</Table.Td>
                                    <Table.Td>
                                        <Text c={status.api === "up" ? "green" : "red"}>
                                            {status.api === "up" ? "Up" : "Down"}
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                                <Table.Tr>
                                    <Table.Td>Cascade Server</Table.Td>
                                    <Table.Td>
                                        <Text c={status.cascade === "up" ? "green" : "red"}>
                                            {status.cascade === "up" ? "Up" : "Down"}
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                                <Table.Tr>
                                    <Table.Td>ECMWF Connection</Table.Td>
                                    <Table.Td>
                                        <Text c={status.ecmwf === "up" ? "green" : "red"}>
                                            {status.ecmwf === "up" ? "Up" : "Down"}
                                        </Text>
                                    </Table.Td>
                                </Table.Tr>
                            </>
                        )}
                    </Table.Tbody>
                </Table>
            </Paper>
        </Container>
    );
};

export default StatusPage;