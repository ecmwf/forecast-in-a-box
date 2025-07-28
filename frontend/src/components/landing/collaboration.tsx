
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

const Collaboration = () => {

  return (
    <Container fluid bg="#e0e0eb">
      <Divider color="#fff" />
      <Container size="lg">
        <Space h="xl" />
        <Space h="xl" />
        <Center>
            <Title style={{color: "#424270"}} size={40}>A Collaboration between</Title>
        </Center>
        <Space h="md" />
        <Group gap='xs' justify="space-evenly">
          <Image src="logos/org/ECMWF.png" w={240} />
          <Image src="logos/org/MetNorway.png" w={240}/>
          <Image src="logos/org/destine-fund.png" w={240} />
        </Group>
        <Space h="xl" />
        <Space h="xl" />
      </Container>
    </Container>
  )
};

export default Collaboration;
