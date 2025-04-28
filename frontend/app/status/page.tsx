"use client";

import React from 'react';
import { Container, Group, Space } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Table, Loader, Center, Title, Progress, Button, Flex, Divider, Tooltip, FileButton} from '@mantine/core';

import { IconRefresh, IconTrash } from '@tabler/icons-react';
import classes from './status.module.css';
import { showNotification } from '@mantine/notifications';

import {useApi} from '@/app/api';

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
  const api = useApi();

  const getStatus = async () => {
    try {
      setLoading(true);
      const response = await api.get('/jobs/status');

      const data: StatusResponse = await response.data;
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
      const response = await api.post(`/jobs/flush`, {
        headers: { "Content-Type": "application/json" },
      });

      const result = await response.data();

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
    getStatus();
  };

  const restartJob = async (jobId: string) => {
    try {
      setLoading(true);
      const response = await api.get(`/jobs/restart/${jobId}`, {
        headers: { "Content-Type": "application/json" },
      });

      await response.data();

    }
    catch (error) {
      console.error('Error fetching job statuses:', error);
    }
    finally {
      setLoading(false);
    }
    getStatus();
  };

  const deleteJob = async (jobId: string) => {
    try {
      setLoading(true);
      const response = await api.delete(`/jobs/delete/${jobId}`, {
        headers: { "Content-Type": "application/json" },
      });
      await response.data();
    }
    catch (error) {
      console.error('Error fetching job statuses:', error);
    }
    finally {
      setLoading(false);
    }
    getStatus();
  };

  const handleFileUpload = (file) => {
    console.log("File selected:", file);
    if (file) {
      const formData = new FormData();
      formData.append("file", file);

      api.post("/jobs/upload", formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
        .then((response) => response.data)
        .then(() => {
          showNotification({
            id: `upload-success-${crypto.randomUUID()}`,
            position: "top-right",
            autoClose: 3000,
            title: "Upload Successful",
            message: "File uploaded successfully",
            color: "green",
          });
          getStatus();
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
    getStatus();
  }, []);

  return (
    <Container size="lg" pt="xl" pb="xl">
      <Flex gap='xl'>
        <Title>Status</Title>
        <FileButton onChange={handleFileUpload}>
          {(props) => <Button color='green' {...props}>Upload</Button>}
        </FileButton>
        <Button onClick={getStatus}>
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