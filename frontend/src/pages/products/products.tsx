// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

import { IconChartScatter, IconListDetails, IconPointer, IconCrystalBall, IconStopwatch } from '@tabler/icons-react';
import {
  Badge,
  Button,
  Card,
  Center,
  Container,
  Grid,
  Group,
  SimpleGrid,
  Space,
  Text,
  Title,
  useMantineTheme,
} from '@mantine/core';

import classes from './products.module.css';

import MainLayout from '../../layouts/MainLayout';


const interfaces = [
  {
    title: 'Quick Start',
    description:
      'Quickly start with a simple interface to get you going.',
    icon: IconStopwatch,
    id: 'quick',
    status: 'alpha',
    link: '/quick',
  },
  {
    title: 'Standard',
    description:
      'Select from a standard list of products, making readable, comphrehensible plots.',
    icon: IconChartScatter,
    id: 'standard',
    status: 'alpha',
    link: '/products/standard',
  },
  {
    title: 'Detailed',
    description:
      'Build a shopping cart out of all the products available, and then compute them.',
    icon: IconListDetails,
    id: 'detailed',
    status: 'beta',
    link: '/products/detailed',
  },
  {
    title: 'Interactive',
    description:
      'Spinup an interactive visualiser with ease.',
    icon: IconPointer,
    id: 'interactive',
    status: 'coming-soon',
    link: '/products/interactive',
  },
  {
    title: 'All',
    description:
      'All products.',
    icon: IconCrystalBall,
    id: 'all',
    status: 'alpha',
  },
];

export default function ProductsCards() {
  const theme = useMantineTheme();
  const features = interfaces.map((feature) => (
    <Card
        key={feature.title}
        shadow="md"
        radius="md"
        // className={classes.card}
        className={feature.status === 'coming-soon' ? classes.cardDisabled : classes.card}
        padding="xl"
        component="a"
        href={feature.link}
        // style={feature.status === 'coming-soon' ? { opacity: 0.6, color:'grey', pointerEvents: 'none' } : {}}
    >
        <Group justify="space-between" mb="xs">
            <feature.icon size={50} stroke={1.5} color={theme.colors.blue[6]} />
            <Badge variant="filled" size="sm">
                {feature.status}
            </Badge>
        </Group>
        <Text fz="lg" fw={500} className={classes.cardTitle} mt="md">
            {feature.title}
        </Text>
        <Text fz="sm" c="dimmed" mt="sm">
            {feature.description}
        </Text>
        <Space h="xs" />
    </Card>
  ));

  return (
    <MainLayout>
    <Container size="xl" py="xl">
      <Title order={2} className={classes.title} ta="center" mt="sm">
        Product Options
      </Title>

        <Center>
        <Text c="dimmed" className={classes.description} ta="center" mt="md">
            Choose the interface that fits your needs. All models are accessible through every interface.
        </Text>
      </Center>

      <Grid gutter="xl" mt={50} grow columns={4}>
        {features.slice(0, 4).map((feature) => <Grid.Col span={{base: 4, sm:4, md:2, xl: 1}}>{feature}</Grid.Col>)}
        <Grid.Col span={3}>
          <Space h='xl'/>
        </Grid.Col>
        <Grid.Col span={3}>
          {features[4]}
        </Grid.Col>
      </Grid>
    </Container>
    </MainLayout>
  );
}