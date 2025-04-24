"use client";

import React from 'react';
import { Container, Group, Space } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Table, Loader, Center, Title, Progress, Button, Flex, Divider, Tooltip, Text} from '@mantine/core';

import { IconRefresh, IconTrash } from '@tabler/icons-react';
import classes from './status.module.css';
import { showNotification } from '@mantine/notifications';


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
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      const result = await response.json();

      showNotification({
        id: `flushed-result-form-${crypto.randomUUID()}`,
        position: 'top-right',
        autoClose: 3000,
        title: "Jobs Flushed",
        message: `${result.deleted_count} jobs deleted`,
        color: 'red',
        icon: <IconTrash />,
        loading: false,
      });

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
        method: "DELETE",
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

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const formData = new FormData();
      formData.append("file", file);

      fetch("/api/py/jobs/upload", {
        method: "POST",
        body: formData,
      })
        .then((response) => response.json())
        .then(() => {
          showNotification({
            id: `upload-success-${crypto.randomUUID()}`,
            position: "top-right",
            autoClose: 3000,
            title: "Upload Successful",
            message: "File uploaded successfully",
            color: "green",
          });
          fetchJobs();
        })
        .catch((error) => {
          console.error("Error uploading file:", error);
          showNotification({
            id: `upload-error-${crypto.randomUUID()}`,
            position: "top-right",
            autoClose: 3000,
            title: "Upload Failed",
            message: "Failed to upload file",
            color: "red",
          });
        });
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  return (
    <Container size="lg" pt="xl" pb="xl">
      <Flex gap='xl'>
        <Title>Status</Title>
        <Button component="label" color='green'>
          Upload
          <input
            type="file"
            hidden
            onChange={handleFileUpload}
          />
        </Button>
        <Button onClick={fetchJobs}>
          Refresh
        </Button>
        <Button onClick={flushJobs} color="red" disabled={Object.keys(jobs.progresses || {}).length === 0}>
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
              <Table.Th>Options</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {Object.keys(jobs.progresses || {}).length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={4} style={{ textAlign: "center", padding: "16px" }}>
                  No jobs found.
                </Table.Td>
              </Table.Tr>
            ) : (
              Object.entries(jobs.progresses || {}).map(([jobId, progress]: [string, ProgressResponse]) => (
                <Table.Tr key={jobId}>
                    <Table.Td align='left'>
                      <Tooltip label="Click to view progress">
                    <Button
                      variant="subtle"
                      c="blue"
                      p="xs"
                      component='a'
                      href={`/progress/${jobId}`}
                      classNames={classes}
                    >{jobId}
                    </Button>
                    </Tooltip>
                    </Table.Td>
                  <Table.Td>
                    {progress.status}
                  </Table.Td>
                  <Table.Td>
                    {progress.progress}%
                    <Progress value={parseFloat(progress.progress)} size="sm" style={{ flex: 1 }} />
                    </Table.Td>
                    <Table.Td>
                      <Group align='center'>
                        <Tooltip label="Restart Job">
                    <Button
                      color='orange'
                      onClick={() => restartJob(jobId)}
                      size='xs'
                      aria-label="Restart Job"
                      ><IconRefresh/></Button></Tooltip>
                      <Tooltip label="Delete Job">
                    <Button
                      color='red'
                      onClick={() => deleteJob(jobId)}
                      size='xs'
                      ><IconTrash/></Button></Tooltip>
                      </Group>
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