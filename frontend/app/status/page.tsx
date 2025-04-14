"use client";

import React from 'react';
import { Container } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Table, Loader, Center, Title, Progress, Button, Flex, Divider} from '@mantine/core';

import { IconRefresh, IconTrash } from '@tabler/icons-react';
import classes from './status.module.css';


export type ProgressResponse = {
  progress: string;
  status: number;
  error: string;
}

export type StatusResponse = {
  progresses: Record<string, ProgressResponse>;
};


const HomePage = () => {

  const [jobs, setJobs] = useState<StatusResponse>({} as StatusResponse);
  const [loading, setLoading] = useState(true);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/py/jobs/status`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      const data: StatusResponse = await response.json();
      console.log(data);
      setJobs(data);
      
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

      await response.json();

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

      await response.json();

    }
    catch (error) {
      console.error('Error fetching job statuses:', error);
    }
    finally {
      setLoading(false);
    }
    fetchJobs();
  };

  const deleteJob = async (jobId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/py/jobs/delete/${jobId}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      await response.json();
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
    <Container size="lg" pt="xl" pb="xl">
      <Flex gap='xl'>
        <Title>Status</Title>
        <Button onClick={fetchJobs}>
          Refresh
        </Button>
        <Button onClick={flushJobs} color="red">
          Flush
        </Button>
      </Flex>
      <Divider my='lg' />
      {loading ? (
        <Center>
          <Loader />
        </Center>
      ) : (
        <Table striped highlightOnHover verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr style={{ backgroundColor: "#f0f0f6", textAlign: "left" }}>
              <Table.Th>Job ID</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th>Progress</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.keys(jobs.progresses || {}).length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={3} style={{ textAlign: "center", padding: "16px" }}>
                  No jobs found.
                </Table.Td>
              </Table.Tr>
            ) : (
              Object.entries(jobs.progresses || {}).map(([jobId, progress]: [string, ProgressResponse]) => (
                <Table.Tr key={jobId}>
                    <Table.Td style={{ display: "flex"}}>
                    <Button
                      variant="subtle"
                      color="blue"
                      p="xs"
                      component='a'
                      href={`/progress/${jobId}`}
                      classNames={{"label": classes['label']}}
                    >
                      {jobId}
                    </Button>
                    </Table.Td>
                  <Table.Td>
                    {progress.status}
                  </Table.Td>
                  <Table.Td style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    {progress.progress}%
                    <Progress value={parseFloat(progress.progress)} size="sm" style={{ flex: 1 }} />
                    <Button
                      color='orange'
                      onClick={() => restartJob(jobId)}
                      size='xs'
                      aria-label="Restart Job"
                      ><IconRefresh/></Button>
                    <Button
                      color='red'
                      onClick={() => deleteJob(jobId)}
                      size='xs'
                      ><IconTrash/></Button>
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