
// (C) Copyright 2024- ECMWF.
//
// This software is licensed under the terms of the Apache Licence Version 2.0
// which can be obtained at http://www.apache.org/licenses/LICENSE-2.0.
//
// In applying this licence, ECMWF does not waive the privileges and immunities
// granted to it by virtue of its status as an intergovernmental organisation
// nor does it submit to any jurisdiction.

'use client';
import React, { useState, useEffect, useRef } from "react";

import { Container, Title, Center, Space, Text, Group, Divider, Image } from "@mantine/core";

const DAG = () => {
  const [showIframe, setShowIframe] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowIframe(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);



  return (
    <Container fluid bg="#e0e0eb">
      <Divider color="#fff" />
      <Container size="lg">
        <Space h="xl" />
        <Space h="xl" />
        <Center>
          <Title size={40}>Dynamic Product Execution</Title>
        </Center>
        <Space h="xl" />

        <Center>
          <Text>From anemoi to pproc, all in the box.</Text>
        </Center>
            <Space h="xl" />

        <Center>
            {showIframe && (
                <iframe
                    src="/dag/example.html"
                    width="100%"
                    height="620px"
                    style={{ border: "none" }}
                    title="Dynamic Product Execution"
                ></iframe>
            )}
        </Center>
        <Space h="xl" />
        <Space h="xl" />
      </Container>
    </Container>
  )
};

export default DAG;
