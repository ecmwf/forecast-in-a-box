
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

'use client';

import { Container, Title, Center, Space, Group, Divider, Image } from "@mantine/core";


const Packages = () => {


  return (
    <Container fluid bg="#3F3F6B">
      <Divider color="#fff" />
      <Container size="lg">
        <Space h="xl" />
        <Space h="xl" />
        <Center>
            <Title style={{color: "white"}} size={40}>Building on top of</Title>
        </Center>
        <Space h="xl" />
        <Group gap={0} justify="space-evenly">
          <Image src="logos/packages/earthkit-dark.svg" w={240} style={{ paddingTop: "5px" }} />
          <Image src="logos/packages/anemoi.webp" w={240} style={{ paddingTop: "12px" }} />
        </Group>
        <Space h="xl" />
        <Space h="xl" />
      </Container>
    </Container>
  )
};

export default Packages;
