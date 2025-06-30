
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

"use client";

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout';

import {Card, Title, Text, Space, Group, Button, Combobox, useCombobox, InputBase, Input, Stack, Grid, Center} from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { DatePickerInput } from '@mantine/dates';
import dayjs from 'dayjs';

import useKeyboardShortcuts from '../hooks/keyboardShortcuts';

import DrumComboBox from '../components/selector/DrumComboBox';

import FireworksComponent from '../components/fireworks';


import ProgressComponent from '../components/jobs/progress';
import { useApi } from '../api';
import { EnvironmentSpecification, ExecutionSpecification, ModelSpecification, ProductSpecification, SubmitResponse} from '../components/interface';
import { IconCheck, IconX } from '@tabler/icons-react';


const times = [
  'T00',
  'T06',
  'T12',
  'T18',
];


const products: Record<string, ProductSpecification[]> = {
    '2t, MSLP and Winds': [{
        product: "Plots/Maps",
        specification: {
            param: [
                "2t",
                "msl",
                "10u",
                "10v"
            ],
            levtype: "sfc",
            domain: "Europe",
            reduce: "True",
            step: [
                "*",
            ]
        }
    },
    {
      product: "Standard/Output",
      specification: {
            param: [
                "2t",
                "msl",
                "10u",
                "10v"
            ],
            levtype: "sfc",
            reduce: "True",
            format: "grib",
            step: [
                "*"
            ]
      }
    }],
    'TP, MSLP and Winds': [{
        product: "Plots/Maps",
        specification: {
            param: [
                "tp",
                "msl",
                "10u",
                "10v"
            ],
            levtype: "sfc",
            domain: "Europe",
            reduce: "True",
            step: [
                "*",
            ]
        }
    },
    {
      product: "Standard/Output",
      specification: {
            param: [
                "tp",
                "msl",
                "10u",
                "10v"
            ],
            levtype: "sfc",
            reduce: "True",
            format: "grib",
            step: [
                "*"
            ]
      }
    }],
}

export default function QuickLaunch() { 
    const api = useApi();
    const navigate = useNavigate();
    
    const params = new URLSearchParams(location.search)
    const job_id = params.get('jobId') || null;

    const [date, setDate] = useState(new Date());
    const [timeValue, setTimeValue] = useState<string | null>('T00');
    const combobox = useCombobox({
        onDropdownClose: () => combobox.resetSelectedOption(),
    });
    // Track last scrub time and count
    const [scrubInfo, setScrubInfo] = useState({ last: 0, count: 0 });

    const scrubDate = (delta) => {
        const now = Date.now();
        let count = scrubInfo.count;
        if (now - scrubInfo.last < 50) {
            count += 1;
        } else {
            count = 1;
        }
        setScrubInfo({ last: now, count });

        if (date) {
            let newDate;
            // If pressed quickly 3 or more times, change month
            if (count >= 3) {
                newDate = dayjs(date).add(delta, 'month');
            } else {
                newDate = dayjs(date).add(delta, 'day');
            }
            const today = dayjs().startOf('day');
            const minDate = dayjs(new Date(2010, 0, 1));
            if (newDate.isAfter(today)) {
                setDate(today.toDate());
            } else if (newDate.isBefore(minDate)) {
                setDate(minDate.toDate());
            } else {
                setDate(newDate.toDate());
            }
        }
    };

    const leadTimeOptions = Array.from({ length: 24 }, (_, i) => `${(i + 1) * 6} hours`);
    const [leadTimeIndex, setLeadTimeIndex] = useState<number>(6);
    const [leadTimeValue, setLeadTimeValue] = useState<string>(leadTimeOptions[leadTimeIndex]);

    const updateLeadTime = () => {
        setLeadTimeIndex((prev) => prev + 1);
    };

    const productOptions = Object.keys(products)
    const [productIndex, setProductIndex] = useState<number>(1);
    const [productValue, setProductValue] = useState<string>(productOptions[productIndex]);

    const updateProductIndex = () => {
        setProductIndex((prev) => prev + 1);
    };
    
    const [modelOptions, setModelOptions] = useState<string[]>(['Loading...']);
    const [modelOptionsIndex, setmodelOptionsIndex] = useState<number>(0);
    const [modelValue, setModelValue] = useState<string>(modelOptions[modelOptionsIndex] || 'Loading...');

    const fetchModelOptions = async () => {
        try {
            const res = await api.get('/v1/model/available');
            const data: Record<string, string[]> = await res.data; 
            // Flatten the record by prepending the key to each value
            const flattened = Object.entries(data).flatMap(
                ([key, values]) => values.map((value) => `${key}_${value}`)
            );
            setModelOptions(flattened);
            setModelValue(flattened[modelOptionsIndex] || 'Loading...');
        } finally {

        }
    };
    const updateModelOptions = () => {
        setmodelOptionsIndex((prev) => prev + 1);
    };

    useEffect(() => {
        fetchModelOptions();
    }, []);
    
    useKeyboardShortcuts({
        F13: () => updateModelOptions(),
        z: () => updateModelOptions(),

        F16: () => updateLeadTime(),
        x: () => updateLeadTime(),

        F17: () => updateProductIndex(),
        c: () => updateProductIndex(),

        Enter: () => handleSubmit(),

        F18: () => scrubDate(-1),
        VolumeDown: () => scrubDate(-1),
        F19: () => scrubDate(1),
        VolumeUp: () => scrubDate(1),

    });

    const timeOptions = times.map((item) => (
        <Combobox.Option value={item} key={item}>
            {item}
        </Combobox.Option>
    ));

    const [jobId, setJobId] = useState<string | null>(job_id);

    const [showFireworks, setShowFireworks] = useState(false);
    const [onCooldown, setOnCooldown] = useState(false);

    const handleFireworksComplete = () => {
        setShowFireworks(false);
    };


    const handleSubmit = () => {
        // if (jobId) {
        //     if (!window.confirm("A job is already running. Are you sure you want to launch a new one?")) {
        //         return;
        //     }
        // }

        const formattedDate = dayjs(date).format('YYYYMMDD');
        const spec: ExecutionSpecification = {
            job: {
                job_type: "forecast_products",
                model: {
                    model: modelValue,
                    lead_time: Number(leadTimeValue.split(' ')[0]),
                    date: `${formattedDate}${timeValue}`,
                    ensemble_members: 1, // Default to 1, can be changed later
                } as ModelSpecification,
                products: products[productValue],
            },
            environment: {} as EnvironmentSpecification
        }
        
        setOnCooldown(true);
        const execute = async () => {
        
            (async () => {
                try {
                    const response = await api.post(`/v1/graph/execute`, spec);
                    const result: SubmitResponse = await response.data;
                    if (result.error) {
                        alert("Error: " + result.error);
                        showNotification(
                            {
                                title: 'Error',
                                message: `An error occurred while submitting the graph.\n ${result.error}`,
                                color: 'red',
                                icon: <IconX size={16} />,
                            }
                        )
                    } else {
                        setShowFireworks(true);
                        showNotification(
                            {
                                title: 'Success',
                                message: `Graph submitted successfully! Job ID: ${result.id}`,
                                color: 'green',
                                icon: <IconCheck size={16} />,
                            }
                        )
                        setJobId(result.id);
                        navigate(`/quick?jobId=${result.id}`);
                    }

                } catch (error) {
                    console.error("Error executing:", error);
                    showNotification(
                        {
                            title: 'Error',
                            message: `An error occurred while submitting the graph.\n ${error.response.data.detail}`,
                            color: 'red',
                            icon: <IconX size={16} />,
                        }
                    )
                } finally {
                    setTimeout(() => {
                        setOnCooldown(false);
                    }, 2000); // Cooldown for 2 seconds
                }
            })();
        };
        execute();
    }

  return (
    <MainLayout>
        {/* {showFireworks && ( */}
            <FireworksComponent trigger={showFireworks} onComplete={handleFireworksComplete} />
        {/* )} */}
        {/* <Modal opened={showModal} onClose={close} title="Focus demo">
            <FocusTrap.InitialFocus />
            <TextInput label="First input" placeholder="First input" />
            <TextInput
            data-autofocus
            label="Input with initial focus"
            placeholder="It has data-autofocus attribute"
            mt="md"
            />
        </Modal> */}

        {/* <Container w='100%' pt='md' h='100%'> */}
            <Space h="md" />
            <Grid h='80vh' justify='space-between' align='stretch'>
                <Grid.Col span={{base: 12, 'md': 7}} h='80vh'>
                <Card shadow="sm" p="lg" radius="md" withBorder h='100%'>
                <Card.Section p='md'>
                    <Title order={2}>Quick Launch</Title>
                    <Text size="sm" c="dimmed" pt='xs'>
                        Use the keyboard shortcuts to quickly navigate and configure the system.
                    </Text>
                </Card.Section>
                
                <Title order={3} pt='md'>Initial Conditions</Title>
                <Group grow justify='space-between' align='center' pt='md'>
                    <DatePickerInput
                        value={date}
                        onChange={(value) => setDate(value ? new Date(value) : null)}
                        placeholder="Pick a date"
                        minDate={new Date(2010, 0, 1)}
                        maxDate={new Date()}
                    />
                    <Combobox
                        store={combobox}
                        withinPortal={false}
                        onOptionSubmit={(val) => {
                            setTimeValue(val);
                            combobox.closeDropdown();
                        }}
                    >
                    <Combobox.Target>
                        <InputBase
                            component="button"
                            type="button"
                            pointer
                            rightSection={<Combobox.Chevron />}
                            onClick={() => combobox.toggleDropdown()}
                            rightSectionPointerEvents="none"
                        >
                        {timeValue || <Input.Placeholder>Pick value</Input.Placeholder>}
                        </InputBase>
                    </Combobox.Target>

                    <Combobox.Dropdown>
                        <Combobox.Options>{timeOptions}</Combobox.Options>
                    </Combobox.Dropdown>
                    </Combobox>

                </Group>
                <Space h="md" />
                <Stack justify='space-between' h='100%' w='100%'>
                <Title order={3} pt='md'>Config</Title>
                <Group justify='space-between' grow align='center' pt='md' mih='50%'>
                    <Stack align='center'>
                        <Title order={3} size='md'>Model</Title>

                        <DrumComboBox
                            options={modelOptions || []}
                            trigger={modelOptionsIndex}
                            onChange={setModelValue}
                        />
                    </Stack>
                    <Stack align='center'>
                        <Title order={3} size='md'>Leadtime</Title>

                        <DrumComboBox
                            options={leadTimeOptions}
                            trigger={leadTimeIndex}
                            defaultIndex={5}
                            onChange={setLeadTimeValue}
                        />
                    </Stack>
                    <Stack align='center'>
                        <Title order={3} size='md'>Products</Title>

                        <DrumComboBox
                            options={productOptions}
                            trigger={productIndex}
                            onChange={setProductValue}
                        />
                    </Stack>
                </Group>
                    <Button
                        title='Launch'
                        variant="filled"
                        fullWidth
                        color='red'
                        size="xl"
                        h={80}
                        onClick={() => handleSubmit()}
                        disabled={onCooldown}
                    >
                        <Title mt='xl' mb='xl' order={2} c='white'>Launch</Title>
                    </Button>
                </Stack>
                </Card>
                </Grid.Col>
                <Grid.Col span={{base: 12, 'md': 5}} h='80vh'>
                    <Card shadow="sm" p="lg" radius="md" withBorder h='100%'>
                        { jobId ? (
                            <ProgressComponent id={jobId} popout={true} />
                        ) : (
                            <Center h='100%' w='100%' style={{ textAlign: 'center' }}>
                                {/* <Loader size="xl" style={{ textAlign: 'center' }}/> */}
                                <Text>Waiting on a job...</Text>
                            </Center>
                        )}
                    </Card>
                </Grid.Col>
        </Grid>
        {/* </Container> */}
   </MainLayout>
  );
};

