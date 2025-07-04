
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import { useEffect, useState, useRef } from "react";
import {
  Container,
  Button,
  Title,
  Text,
  Box,
  ScrollArea,
  Group,
  Code,
  Paper,
} from "@mantine/core";


import {useApi} from '../../api';

function Gateway() {
  const [logs, setLogs] = useState([]);
  const [eventSource, setEventSource] = useState<EventSource | null>(null);
  const scrollRef = useRef(null);

  const [status, setStatus] = useState('not running');

  const api = useApi();

  const startProcess = async () => {
    await api.post("/v1/gateway/start");
    await checkStatus();
    setLogs([]);
    fetchLogs();
  }

  const fetchLogs = async () => {
    if (eventSource) {
        eventSource.close();
    }

    let source = new EventSource(`/api/v1/gateway/logs`);
    source.onopen = () => {
        console.log("EventSource connection opened");
        setLogs((prev) => [...prev, "Connecting to Cascade Gateway..."]);
    };
    source.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
            const logLine = data.log || e.data;
            setLogs((prev) => [...prev, logLine]);
        } catch {
            setLogs((prev) => [...prev, e.data]);
        }
    };

    source.addEventListener("done", (e) => {
        try {
            const data = JSON.parse(e.data);
            setLogs((prev) => [...prev, `🟢 ${data.message || e.data}`]);
        } catch {
            setLogs((prev) => [...prev, `🟢 ${e.data}`]);
        }
        source.close();
    });
    source.onerror = (e) => {
        setLogs((prev) => [...prev, "❌ Error connecting to Cascade Gateway"]);
        source.close();
    };
    setEventSource(source);
  };

  const killProcess = async () => {
    await api.post(`/v1/gateway/kill`);
    if (eventSource) {
        eventSource.close();
    }
    checkStatus();
    setLogs((prev) => [...prev, "Gateway process killed"]);
  };

  const checkStatus = async () => {
    const res = await api.get("/v1/gateway/status");
    setStatus(res.data);
  };

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [logs]);

    useEffect(() => {
        checkStatus();
        fetchLogs();
        return () => {
            if (eventSource) {
                eventSource.close();
            }
        };
    }, []);

    return (
        <Container py="md" h="xl">
            <Title order={2} mb="md">
                Cascade Gateway - {status}
            </Title>

            <Group mb="md" justify="space-between" grow>
                <Button onClick={startProcess} color="blue" disabled={status == 'running'}>
                    Start Gateway
                </Button>
                <Button onClick={fetchLogs} color="green" disabled={status !== 'running'}>
                    Refresh Logs
                </Button>
                <Button onClick={killProcess} color="red" disabled={status !== 'running'}>
                    Kill Gateway
                </Button>
            </Group>

            <Paper bg="#0f111a" withBorder p="md" shadow="xs" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <ScrollArea.Autosize
                style={{ flexGrow: 1, minHeight: '50vh', maxHeight: "65vh"}}
                scrollbarSize={8}
                offsetScrollbars
                type="always"
                scrollHideDelay={0} // show scrollbar at all times
                ref={scrollRef}
                >
                <Box
                    component="pre"
                    p="sm"
                    style={{
                    backgroundColor: "#0f111a",
                    color: "#e5e9f0",
                    fontFamily: "monospace",
                    fontSize: "0.9rem",
                    borderRadius: "8px",
                    whiteSpace: "pre-wrap", // wrap long lines
                    overflowY: "scroll",    // always show scrollbar
                    margin: 0,
                    }}
                >
                    {logs.length === 0 ? (
                        <Text c="dimmed">No logs yet...</Text>
                    ) : (
                        logs.join("\n")
                    )}
                </Box>
                </ScrollArea.Autosize>
            </Paper>
        </Container>
    );
}

export default Gateway;
