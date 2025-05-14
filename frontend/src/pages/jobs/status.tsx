
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useRef } from 'react';
import { Container, Group } from '@mantine/core';
import { useEffect, useState } from 'react';
import { Table, Loader, Center, Title, Progress, Button, Flex, Divider, Tooltip, FileButton, Menu, Burger, Modal} from '@mantine/core';

import { IconDownload, IconRefresh, IconTrash } from '@tabler/icons-react';
import classes from './status.module.css';
import { showNotification } from '@mantine/notifications';

import {useApi} from '../../api';
import MainLayout from '../../layouts/MainLayout';

import { ExecutionSpecification } from '../../components/interface';

import Cart from './../../components/products/cart';

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

  const [working, setWorking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const api = useApi();
  const progressIntervalRef = useRef<null>(null);

  const getStatus = async () => {
    try {
      const response = await api.get('/v1/job/status');

      const data: StatusResponse = await response.data;
      setJobs(data);
      
    } catch (error) {
      showNotification({
        id: `status-error-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Error getting status",
        message: `${error.response?.data?.detail? error.response?.data?.detail : ''}`,
        color: "red",
      });    
    } finally {
      setLoading(false);
    }
  };

  const flushJobs = async () => {
    try {
      setWorking(true);
      const response = await api.post(`/v1/job/flush`, {
        headers: { "Content-Type": "application/json" },
      });

      const result = await response.data;

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
      showNotification({
        id: `flush-error-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Flush Failed",
        message: `${error.response?.data?.detail}`,
        color: "red",
      });

    } finally {
      setLoading(false);
      setWorking(false);
    }
    getStatus();
  };

  const downloadJob = async (jobId: string) => {
    try {
      setWorking(true);
      // setLoading(true);
      const response = await api.get(`/v1/job/${jobId}/specification`, {
      headers: { "Content-Type": "application/json" },
      });

      const blob = new Blob([JSON.stringify(response.data, null, 2)], { type: 'application/json' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `${crypto.randomUUID()}.json`);
      link.click();
      link.remove();

    } catch (error) {
      showNotification({
        id: `download-error-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Download Failed",
        message: `${error.response?.data?.detail}`,
        color: "red",
      });
    } finally {
      setWorking(false);
    }
  };

  const restartJob = async (jobId: string) => {
    try {
      setWorking(true);
      // setLoading(true);
      const response = await api.get(`/v1/job/${jobId}/restart`, {
      headers: { "Content-Type": "application/json" },
      });

      const job = await response.data;

      showNotification({
        id: `restart-success-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Restart Successful",
        message: `Job ${job['job_id']} created successfully`,
        color: "green",
      });
    } catch (error) {
      showNotification({
        id: `restart-error-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Restart Failed",
        message: `${error.response?.data?.detail}`,
        color: "red",
      });
    } finally {
      setLoading(false);
      setWorking(false);
    }
    getStatus();
  };

  const deleteJob = async (jobId: string) => {
    try {
      setWorking(true);
      // setLoading(true);
      const response = await api.delete(`/v1/job/${jobId}`);
      await response.data;

      showNotification({
        id: `upload-success-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Delete Successful",
        message: "Job deleted successfully",
        color: "green",
      });
    }
    catch (error) {
      showNotification({
        id: `delete-error-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Delete Failed",
        message: `${error.response?.data?.detail}`,
        color: "red",
      });
    }
    finally {
      setLoading(false);
      setWorking(false);
    }
    getStatus();
  };

  const handleFileUpload = (file) => {
    setUploading(true);
    setWorking(true);
    console.log("File selected:", file);
    if (file) {
      const formData = new FormData();
      formData.append("file", file);

      api.post("/v1/job/upload", formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      })
        .then((response) => response.data)
        .then((data) => {
          showNotification({
            id: `upload-success-${crypto.randomUUID()}`,
            position: "top-right",
            autoClose: 3000,
            title: "Upload Successful",
            message:`File uploaded successfully. ${data.job_id} started`,
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
    setUploading(false);
    setWorking(false);
  };

  const [showMoreInfo, setShowMoreInfo] = useState(false);
  const [moreInfoSpec, setMoreInfoSpec] = useState({} as ExecutionSpecification);

  const handleMoreInfo = (jobId: string) => {
    setWorking(true);
    try {
      api.get(`/v1/job/${jobId}/specification`)
        .then((response) => {
          setMoreInfoSpec(response.data);
          setShowMoreInfo(true);
        })
        .catch((error) => {
          console.error("Error getting job specification:", error);
          showNotification({
            id: `more-info-error-${crypto.randomUUID()}`,
            position: "top-right",
            autoClose: 3000,
            title: "Error getting job specification",
            message: `${error.response?.data?.detail}`,
            color: "red",
          });
        });
    } catch (error) {
      showNotification({
        id: `more-info-error-${crypto.randomUUID()}`,
        position: "top-right",
        autoClose: 3000,
        title: "Error getting job specification",
        message: `${error.response?.data?.detail}`,
        color: "red",
      });
    }
    setWorking(false);

  }

  useEffect(() => {
    setLoading(true);
    getStatus();
      // Start the interval and store its ID in the ref
      progressIntervalRef.current = setInterval(() => {
        getStatus();
    }, 10000);

    // Cleanup function to clear the interval when the component unmounts or `id` changes
    return () => {
        if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
        }
    };
  }, []);

  const UserButtons = () => {
    return [
      <FileButton key="upload" onChange={handleFileUpload} disabled={uploading}>
        {(props) => (
          <Button color="green" {...props} fullWidth>
            {uploading ? "Uploading" : "Upload"}
          </Button>
        )}
      </FileButton>,
      <Button key="refresh" onClick={() => { setLoading(true); getStatus(); }} fullWidth>
        Refresh
      </Button>,
      <Button
        key="flush"
        onClick={flushJobs}
        color="red"
        disabled={Object.keys(jobs.progresses || {}).length === 0}
        fullWidth
      >
        Flush
      </Button>
    ];
  };

  return (
    <MainLayout>
    <Container size="lg" pt="xl" pb="xl">
    <Modal
        opened={showMoreInfo}
        onClose={() => setShowMoreInfo(false)}
        title="Job Outputs"
        size="lg"
      >
        {moreInfoSpec.products && moreInfoSpec.products.length > 0 && (
          <>
            <Cart 
              products={Object.fromEntries(moreInfoSpec.products.map((product, index) => [index.toString(), product]))} 
              setProducts={(updatedProducts) => {
                moreInfoSpec.products = Object.values(updatedProducts);
              }}
              disable_delete={true}
            />
            {/* <Title order={3}>Model</Title>
            <pre>{JSON.stringify(moreInfoSpec.model, null, 2)}</pre>
            <Title order={3}>Environment</Title>
            <pre>{JSON.stringify(moreInfoSpec.environment, null, 2)}</pre> */}
          </>
        )}

      </Modal>

      <Flex gap='xl' justify={'space-between'} align='center'>
        <Title>Status</Title>
        {working && <Loader/>}
        <Menu shadow="md">
          <Menu.Target>
            <Burger hiddenFrom ="xs"/>
          </Menu.Target>
          <Menu.Dropdown>
            {UserButtons().map((button, index) => (
              <Menu.Item key={index}>
              {button}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
        <Flex visibleFrom='xs' gap='xs' direction='row'>
        {UserButtons().map((button, index) => (
          <div key={index}>
            {button}
          </div>
        ))}
        </Flex>
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
                      <Tooltip label="More Info">
                        <Burger onClick={() => handleMoreInfo(jobId)}/>
                      </Tooltip>
                      <Tooltip label="Click to view progress">
                    <Button
                      variant="subtle"
                      c="blue"
                      p="xs"
                      component='a'
                      href={`/job/${jobId}`}
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
                        <Tooltip label="Download Job">
                        <Button
                          color='blue'
                          onClick={() => downloadJob(jobId)}
                          size='xs'
                          aria-label="Download Job"
                          ><IconDownload/></Button></Tooltip>
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
    </MainLayout>
  );
};

export default HomePage;