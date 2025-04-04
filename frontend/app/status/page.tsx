"use client";

import React from 'react';
import { Container } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Table, Loader, Center, Title, Progress, Button, Flex} from '@mantine/core';

import { IconRefresh } from '@tabler/icons-react';

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
        progress: parseFloat(progress.replace('%', '')),
      }));
      setJobs([])
      setJobs(jobList);
    } catch (error) {
      console.error('Error fetching job statuses:', error);
    } finally {
      setLoading(false);
    }
  };

  const flushJobs = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/py/jobs/flush`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

    } catch (error) {
      console.error('Error fetching job statuses:', error);
    } finally {
      setLoading(false);
    }
    fetchJobs();
  };

  const restartJob = async (jobId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/py/jobs/restart/${jobId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const data = await response.json();

    }
    catch (error) {
      console.error('Error fetching job statuses:', error);
    }
    finally {
      setLoading(false);
    }
    fetchJobs();
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <Container size="lg" pt="xl" pb="xl" mih='85vh'>
      <Flex gap='xl'>
        <Title>Status</Title>
        <Button onClick={fetchJobs}>
          Refresh
        </Button>
        <Button onClick={flushJobs} color="red">
          Flush
        </Button>
      </Flex>
      {loading ? (
        <Center>
          <Loader />
        </Center>
      ) : (
        <Table striped highlightOnHover verticalSpacing="xs" >
          <Table.Thead>
            <Table.Tr style={{ backgroundColor: "#f0f0f6", textAlign: "left" }}>
              <Table.Th>Job ID</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Progress</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {jobs.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={3} style={{ textAlign: "center", padding: "16px" }}>
                  No jobs found.
                </Table.Td>
              </Table.Tr>
            ) : (
              jobs.map((job) => (
                <Table.Tr key={job.id}>
                  <Table.Td style={{ padding: "8px", borderBottom: "1px solid #e0e0e0" }}>
                    <Button
                      variant="subtle"
                      color="blue"
                      p="xs"
                      component='a'
                      href = {`/progress/${job.id}`}>
                      {job.id}
                    </Button>
                  </Table.Td>
                  <Table.Td style={{ padding: "8px", borderBottom: "1px solid #e0e0e0" }}>
                    {job.status}
                  </Table.Td>
                  <Table.Td style={{ padding: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
                    {job.progress}%
                    <Progress value={job.progress} size="sm" style={{ flex: 1 }} />
                    <Button
                      color='red'
                      onClick={() => restartJob(job.id)}
                      size='sm'
                      ><IconRefresh/></Button>
                  </Table.Td>
                </Table.Tr>
              ))
            )}
          </Table.Tbody>
        </Table>
      )}
    </Container>
  );
};

export default HomePage;