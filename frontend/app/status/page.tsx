"use client";

import React from 'react';
import { Container } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Table, Loader, Center, Title, Progress, Button, Flex} from '@mantine/core';


const HomePage = () => {

  const [jobs, setJobs] = useState<{ id: string; status: string; progress: number; }[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/py/jobs/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();
      const progresses = data.progresses;

      const jobList = Object.entries(progresses).map(([id, progress]) => ({
        id,
        status: progress === '100' ? 'Completed' : `In Progress`,
        progress: progress,
      }));
      setJobs(jobList);
    } catch (error) {
      console.error('Error fetching job statuses:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <Container size="lg" pt="xl" pb="xl">
      <Flex gap='xl'>
        <Title>Status</Title>
        <Button onClick={fetchJobs}>
          Refresh
        </Button>
      </Flex>
      {loading ? (
        <Center>
          <Loader />
        </Center>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr style={{ backgroundColor: "#f0f0f6", textAlign: "left" }}>
              <Table.Th>Job ID</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Progress</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {jobs.map((job) => (
              <Table.Tr key={job.id}>
                <Table.Td style={{ padding: "8px", borderBottom: "1px solid #e0e0e0" }}>
                    <Button
                    variant="subtle"
                    color="blue"
                    p='xs'
                    onClick={() => window.location.href = `/progress/${job.id}`}>
                    {job.id}
                    </Button>
                </Table.Td>
                <Table.Td style={{ padding: "8px", borderBottom: "1px solid #e0e0e0" }}>
                  {job.status}
                </Table.Td>
                <Table.Td style={{ padding: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                  {job.progress}% 
                  <Progress value={job.progress} size="sm" style={{ flex: 1 }} />
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
};

export default HomePage;